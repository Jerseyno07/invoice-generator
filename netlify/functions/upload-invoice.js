const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { JWT } = require('google-auth-library');

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

let sheetsAuth;
function getSheetsAuth() {
  if (!sheetsAuth) {
    sheetsAuth = new JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }
  return sheetsAuth;
}

// Preferred upload path: Ninjacart's own doomsday invoice API. Throws on any
// failure so the caller can fall back to R2.
async function uploadToNinjacart(filename, buffer, invNumber) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'application/pdf' }), filename);
  const url = `https://ops.ninjacart.in/asgard_ops/operations/doomsday/invoice/upload?invoiceId=${encodeURIComponent(invNumber)}&fileType=invoice`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: process.env.NINJACART_DOOMSDAY_AUTH,
      Application: 'biFrost',
      appVersion: '7',
    },
    body: form,
  });
  if (!res.ok) throw new Error(`Ninjacart upload failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const match = typeof data.message === 'string' && /File uploaded URL: (\S+)/.exec(data.message);
  if (data.code !== 200 || !match) throw new Error(`Unexpected Ninjacart response: ${JSON.stringify(data)}`);
  return match[1];
}

async function uploadToR2(filename, buffer) {
  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: filename,
    Body: buffer,
    ContentType: 'application/pdf',
  }));
  return `${process.env.R2_PUBLIC_URL_BASE}/${filename}`;
}

async function appendToSheet(row) {
  const auth = getSheetsAuth();
  const { token } = await auth.getAccessToken();
  const range = encodeURIComponent(process.env.GOOGLE_SHEET_RANGE);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [row] }),
  });
  if (!res.ok) throw new Error(`Sheets append failed: ${res.status} ${await res.text()}`);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const { filename, base64, invNumber, customer, date } = JSON.parse(event.body);
    if (!filename || !base64) return { statusCode: 400, body: 'filename and base64 are required' };

    const buffer = Buffer.from(base64, 'base64');
    let url;
    try {
      url = await uploadToNinjacart(filename, buffer, invNumber);
    } catch (err) {
      console.error('Ninjacart doomsday upload failed, falling back to R2:', err.message);
      url = await uploadToR2(filename, buffer);
    }
    await appendToSheet([invNumber || '', customer || '', date || '', url]);

    return { statusCode: 200, body: JSON.stringify({ url }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
