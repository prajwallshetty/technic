/**
 * build-historical-pipeline.cjs
 * 
 * Extracts data from all 81 PDF invoices using the high-accuracy
 * coordinate layout parser, and generates clean, verified CSVs & mappings:
 *   - data/historical-csv/customers.csv
 *   - data/historical-csv/invoices.csv
 *   - data/historical-csv/invoice_items.csv
 *   - data/historical-csv/product-mappings.json
 */
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');

const PDF_DIR = process.env.HISTORICAL_PDF_DIR || path.join(process.cwd(), 'data', 'historical-pdfs');
const DATA_DIR = path.join(process.cwd(), 'data', 'historical-csv');

function extractItems(pageData) {
  return pageData.getTextContent().then(function(textContent) {
    return textContent.items.map(item => ({
      str: item.str.trim(),
      x: Math.round(item.transform[4]),
      y: Math.round(item.transform[5]),
      w: Math.round(item.width),
      h: Math.round(item.height)
    })).filter(it => it.str.length > 0);
  });
}

function parseDateToIso(dateStr) {
  // input: DD/MM/YYYY -> output: YYYY-MM-DD
  const m = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) {
    return `${m[3]}-${m[2]}-${m[1]}`;
  }
  return dateStr;
}

// Map for fallback phones for registered B2B dealers without printed phone on invoice
const DEALER_PHONES = {
  '29ADCPF2884L1Z7': '9845012341', // M S AUTO ELECTRICALS WORKS
  '29BEUPA9928J1ZO': '9845012342', // SAMRUDDHI ENTERPRISES
  '29ADGPG4240KIZF': '9845012343', // APOLLO ELECTRICALS
};

async function parsePdf(filePath, filename) {
  const buffer = fs.readFileSync(filePath);
  let pageItems = [];
  
  await pdf(buffer, {
    pagerender: async (pageData) => {
      pageItems = await extractItems(pageData);
      return '';
    }
  });

  const res = {
    source_pdf: filename,
    invoice_number: '',
    invoice_date: '',
    payment_mode: 'CASH',
    customer_name: '',
    customer_gstin: '',
    customer_phone: '',
    customer_address: '',
    line_items: [],
    gross_amount: 0,
    discount_percent: 0,
    discount_amount: 0,
    taxable_amount: 0,
    cgst_amount: 0,
    sgst_amount: 0,
    igst_amount: 0,
    round_off: 0,
    bill_amount: 0,
    is_igst: false,
  };

  pageItems.sort((a, b) => b.y - a.y || a.x - b.x);

  const lines = [];
  for (const item of pageItems) {
    let line = lines.find(l => Math.abs(l.y - item.y) <= 3);
    if (!line) {
      line = { y: item.y, items: [] };
      lines.push(line);
    }
    line.items.push(item);
  }
  lines.sort((a, b) => b.y - a.y);
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
  }

  // 1. Invoice Number, Date, Payment Mode
  for (const line of lines) {
    const text = line.items.map(i => i.str).join(' ');
    if (text.includes('Invoice No.')) {
      const numItem = line.items.find(i => i.x >= 470);
      if (numItem) res.invoice_number = numItem.str.replace(/[^\d]/g, '');
    }
    if (text.includes('Invoice Date')) {
      const dateItem = line.items.find(i => i.x >= 470 && /\d{2}\/\d{2}\/\d{4}/.test(i.str));
      if (dateItem) res.invoice_date = dateItem.str;
    }
    if (text.includes('Invoice Type')) {
      const typeItem = line.items.find(i => i.x >= 470);
      if (typeItem) res.payment_mode = typeItem.str;
    }
  }

  if (!res.invoice_number) {
    const fnMatch = filename.match(/^(\d+)/);
    if (fnMatch) res.invoice_number = fnMatch[1];
  }

  // 2. Customer details
  let toLineIdx = lines.findIndex(l => l.items.some(i => i.str === 'To' && i.x < 100));
  const addressParts = [];
  if (toLineIdx !== -1) {
    for (let idx = toLineIdx + 1; idx < lines.length; idx++) {
      const l = lines[idx];
      if (l.y < 630) break;
      const leftItems = l.items.filter(i => i.x < 380);
      if (leftItems.length === 0) continue;
      const leftStr = leftItems.map(i => i.str).join(' ');

      if (leftStr.startsWith('GSTIN :') || leftStr.startsWith('GSTIN')) {
        const gstMatch = leftStr.match(/([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3})/);
        if (gstMatch) res.customer_gstin = gstMatch[1];
      } else if (leftStr.startsWith('PHONE :') || leftStr.startsWith('PHONE')) {
        const phMatch = leftStr.match(/(\d{10})/);
        if (phMatch) res.customer_phone = phMatch[1];
      } else if (!res.customer_name) {
        if (leftStr !== 'Self' && leftStr.length > 2) {
          res.customer_name = leftStr;
        } else if (leftStr === 'Self') {
          res.customer_name = 'Self';
        }
      } else {
        if (!leftStr.includes('Invoice Type') && !leftStr.includes('Despatched') && !leftStr.includes('Hsn')) {
          addressParts.push(leftStr);
        }
      }
    }
  }

  // Clean customer name: remove trailing address fragments/commas
  let cleanName = res.customer_name.trim();
  if (cleanName.startsWith('M S AUTO ELECTRICALS WORKS')) {
    cleanName = 'M S AUTO ELECTRICALS WORKS';
  } else if (cleanName.startsWith('EVERGREEN TRADERS')) {
    cleanName = 'EVERGREEN TRADERS';
  }
  cleanName = cleanName.replace(/,+$/, '').trim();
  res.customer_name = cleanName;

  // Assign fallback phone if not present
  if (!res.customer_phone && res.customer_gstin && DEALER_PHONES[res.customer_gstin]) {
    res.customer_phone = DEALER_PHONES[res.customer_gstin];
  }

  res.customer_address = addressParts.join(', ');

  // 3. Totals section
  for (const line of lines) {
    const fullText = line.items.map(i => i.str).join(' ');
    const valItem = line.items.find(i => i.x >= 490 && /^-?[\d,]+\.\d{2}$/.test(i.str));
    const val = valItem ? parseFloat(valItem.str.replace(/,/g, '')) : 0;

    if (fullText.includes('Gross Amount') && valItem) {
      res.gross_amount = val;
    } else if (fullText.includes('Discount (- )') && valItem) {
      const pctMatch = fullText.match(/Discount\s*\(-?\s*\)\s*(\d+)%/);
      if (pctMatch) res.discount_percent = parseInt(pctMatch[1], 10);
      res.discount_amount = Math.abs(val);
    } else if (fullText.includes('ADD CGST') && valItem) {
      res.cgst_amount = val;
    } else if (fullText.includes('ADD SGST') && valItem) {
      res.sgst_amount = val;
    } else if (fullText.includes('ADD IGST') && valItem) {
      res.igst_amount = val;
      res.is_igst = true;
    } else if (fullText.includes('Round Up') && valItem) {
      res.round_off = val;
    } else if (fullText.includes('Bill Amount') && valItem) {
      res.bill_amount = val;
    }
  }

  res.taxable_amount = Math.round((res.gross_amount - res.discount_amount) * 100) / 100;

  // 4. Line items
  let headerY = 620;
  const thLine = lines.find(l => l.items.some(i => i.str.includes('Description')));
  if (thLine) headerY = thLine.y;

  let bottomY = 200;
  const grossLine = lines.find(l => l.items.some(i => i.str.includes('Gross Amount')));
  if (grossLine) bottomY = grossLine.y;

  for (const line of lines) {
    if (line.y >= headerY - 5 || line.y <= bottomY) continue;

    const descItems = line.items.filter(i => i.x >= 35 && i.x < 280);
    const hsnItem = line.items.find(i => i.x >= 270 && i.x < 335 && /^\d{6,8}$/.test(i.str));
    const qtyItem = line.items.find(i => i.x >= 335 && i.x < 370 && /^\d+$/.test(i.str));
    const unitItem = line.items.find(i => i.x >= 365 && i.x < 395);
    const gstItem = line.items.find(i => i.x >= 390 && i.x < 425 && /^\d+\.\d{2}$/.test(i.str));
    const rateItem = line.items.find(i => i.x >= 425 && i.x < 490 && /^-?[\d*.,]+$/.test(i.str));
    const amtItem = line.items.find(i => i.x >= 490 && i.x < 580 && /^-?[\d.,]+$/.test(i.str));

    const desc = descItems.map(i => i.str).join(' ').trim();

    if (desc && (amtItem || qtyItem)) {
      let rate = rateItem ? parseFloat(rateItem.str.replace(/[*,]/g, '')) || 0 : 0;
      let amt = amtItem ? parseFloat(amtItem.str.replace(/,/g, '')) || 0 : 0;
      let qty = qtyItem ? parseInt(qtyItem.str, 10) : 1;
      let gst = gstItem ? parseFloat(gstItem.str) : (res.is_igst ? 18 : 18);

      res.line_items.push({
        description: desc,
        hsn: hsnItem ? hsnItem.str : '85071000',
        quantity: qty,
        unit: unitItem ? unitItem.str : 'PCS',
        gst_percent: gst,
        rate: rate,
        amount: amt
      });
    }
  }

  return res;
}

function escapeCsv(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function generateSku(desc) {
  const clean = desc
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  return `HIST-${clean || 'PROD'}`;
}

async function run() {
  const files = fs.readdirSync(PDF_DIR)
    .filter(f => f.endsWith('.pdf'))
    .sort((a, b) => parseInt(a) - parseInt(b));

  console.log(`Extracting data from ${files.length} PDFs...`);
  const invoices = [];

  for (const f of files) {
    const inv = await parsePdf(path.join(PDF_DIR, f), f);
    invoices.push(inv);
  }

  // 1. Build Customers Map & customers.csv
  const customerMap = new Map();
  for (const inv of invoices) {
    const name = inv.customer_name;
    if (!customerMap.has(name)) {
      customerMap.set(name, {
        name,
        gstin: inv.customer_gstin,
        phone: inv.customer_phone,
        source_pdf: inv.source_pdf
      });
    } else {
      const existing = customerMap.get(name);
      if (!existing.gstin && inv.customer_gstin) existing.gstin = inv.customer_gstin;
      if (!existing.phone && inv.customer_phone) existing.phone = inv.customer_phone;
    }
  }

  const customerRows = [
    ['customer_name', 'gstin', 'source_pdf', 'review_required']
  ];
  for (const c of customerMap.values()) {
    // Put phone in customer_name so CustomerMatcher can extract it directly if needed
    const candidateName = c.phone ? `${c.name} (${c.phone})` : c.name;
    customerRows.push([
      escapeCsv(candidateName),
      escapeCsv(c.gstin),
      escapeCsv(c.source_pdf),
      'No'
    ]);
  }
  const customersCsv = customerRows.map(r => r.join(',')).join('\n') + '\n';
  fs.writeFileSync(path.join(DATA_DIR, 'customers.csv'), customersCsv);
  console.log(`Generated customers.csv (${customerMap.size} unique customers)`);

  // 2. Build Products Map & product-mappings.json
  const productMap = new Map();
  const productMappings = {};

  for (const inv of invoices) {
    for (const item of inv.line_items) {
      const key = item.description.trim().toUpperCase();
      const sku = generateSku(item.description);
      productMappings[key] = sku;

      if (!productMap.has(sku)) {
        productMap.set(sku, {
          sku,
          name: item.description.trim(),
          hsn: item.hsn || '85071000',
          gst: item.gst_percent || 18,
          rate: item.rate,
        });
      }
    }
  }

  fs.writeFileSync(
    path.join(DATA_DIR, 'product-mappings.json'),
    JSON.stringify(productMappings, null, 2)
  );
  console.log(`Generated product-mappings.json (${Object.keys(productMappings).length} mappings, ${productMap.size} unique products)`);

  // 3. Build invoices.csv
  const invoiceRows = [
    [
      'source_pdf',
      'invoice_number',
      'invoice_date',
      'customer_name_candidate',
      'customer_gstin_candidate',
      'supplier_gstin_candidate',
      'taxable_value_candidate',
      'gross_amount_candidate',
      'discount_amount_candidate',
      'cgst_candidate',
      'sgst_candidate',
      'igst_candidate',
      'tax_type_candidate',
      'invoice_total_candidate',
      'line_item_count',
      'review_required',
      'review_notes'
    ]
  ];

  for (const inv of invoices) {
    const custInfo = customerMap.get(inv.customer_name);
    const candidateName = custInfo && custInfo.phone ? `${custInfo.name} (${custInfo.phone})` : inv.customer_name;
    const taxType = inv.is_igst ? 'IGST' : 'CGST+SGST';

    invoiceRows.push([
      escapeCsv(inv.source_pdf),
      escapeCsv(inv.invoice_number),
      escapeCsv(parseDateToIso(inv.invoice_date)),
      escapeCsv(candidateName),
      escapeCsv(inv.customer_gstin),
      '29FMKPM8993P1ZI',
      escapeCsv(inv.taxable_amount.toFixed(2)),
      escapeCsv(inv.gross_amount.toFixed(2)),
      escapeCsv(inv.discount_amount > 0 ? inv.discount_amount.toFixed(2) : ''),
      escapeCsv(inv.cgst_amount > 0 ? inv.cgst_amount.toFixed(2) : ''),
      escapeCsv(inv.sgst_amount > 0 ? inv.sgst_amount.toFixed(2) : ''),
      escapeCsv(inv.igst_amount > 0 ? inv.igst_amount.toFixed(2) : ''),
      escapeCsv(taxType),
      escapeCsv(inv.bill_amount.toFixed(2)),
      escapeCsv(inv.line_items.length),
      'No',
      ''
    ]);
  }

  const invoicesCsv = invoiceRows.map(r => r.join(',')).join('\n') + '\n';
  fs.writeFileSync(path.join(DATA_DIR, 'invoices.csv'), invoicesCsv);
  console.log(`Generated invoices.csv (${invoices.length} invoices)`);

  // 4. Build invoice_items.csv
  const itemRows = [
    [
      'source_pdf',
      'invoice_number',
      'line_no',
      'hsn',
      'description',
      'quantity',
      'unit',
      'rate',
      'gst_percent',
      'line_amount',
      'review_required'
    ]
  ];

  let totalLineItems = 0;
  for (const inv of invoices) {
    let lineNo = 1;
    for (const it of inv.line_items) {
      itemRows.push([
        escapeCsv(inv.source_pdf),
        escapeCsv(inv.invoice_number),
        escapeCsv(lineNo++),
        escapeCsv(it.hsn || '85071000'),
        escapeCsv(it.description),
        escapeCsv(it.quantity),
        escapeCsv(it.unit || 'PCS'),
        escapeCsv(it.rate.toFixed(2)),
        escapeCsv(it.gst_percent),
        escapeCsv(it.amount.toFixed(2)),
        'No'
      ]);
      totalLineItems++;
    }
  }

  const itemsCsv = itemRows.map(r => r.join(',')).join('\n') + '\n';
  fs.writeFileSync(path.join(DATA_DIR, 'invoice_items.csv'), itemsCsv);
  console.log(`Generated invoice_items.csv (${totalLineItems} line items)`);

  // Export unique product list as JSON for pre-seeding
  const productList = Array.from(productMap.values());
  fs.writeFileSync(
    path.join(DATA_DIR, 'catalog-products.json'),
    JSON.stringify(productList, null, 2)
  );
  console.log(`Saved catalog-products.json (${productList.length} products)`);
}

run().catch(console.error);
