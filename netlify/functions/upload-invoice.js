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
    await s3.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: filename,
      Body: buffer,
      ContentType: 'application/pdf',
    }));

    const url = `${process.env.R2_PUBLIC_URL_BASE}/${filename}`;
    await appendToSheet([invNumber || '', customer || '', date || '', url]);

    return { statusCode: 200, body: JSON.stringify({ url }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
