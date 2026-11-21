/** Portable form route materialized at source export, from editor-owned data-form attributes. */
import { parse, traverse } from '@/code/parsing/ast-utils';
import * as t from '@babel/types';

export function collectPortableForms(files: Record<string, string>): Record<string, unknown> {
  const forms: Record<string, unknown> = {};
  for (const [path, code] of Object.entries(files)) {
    if (!/\.[jt]sx$/.test(path) || !code.includes('data-form=')) continue;
    const ast = parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
    traverse(ast, { JSXElement(p) {
      const opening = p.node.openingElement;
      if (!t.isJSXIdentifier(opening.name, { name: 'form' }) && !(t.isJSXMemberExpression(opening.name) && t.isJSXIdentifier(opening.name.property, { name: 'form' }))) return;
      const attrs = opening.attributes.filter(t.isJSXAttribute);
      const id = attrs.find(a => t.isJSXIdentifier(a.name, { name: 'data-id' }));
      const config = attrs.find(a => t.isJSXIdentifier(a.name, { name: 'data-form' }));
      if (!id || !t.isStringLiteral(id.value) || !config || !t.isStringLiteral(config.value)) return;
      if (Object.prototype.hasOwnProperty.call(forms, id.value.value)) throw new Error(`Duplicate form ID: ${id.value.value}`);
      const fields = new Set<string>(), required = new Set<string>(), emails = new Set<string>();
      p.traverse({ JSXOpeningElement(child) {
        const name = child.node.attributes.filter(t.isJSXAttribute).find(a => t.isJSXIdentifier(a.name, { name: 'name' }));
        if (name && t.isStringLiteral(name.value)) {
          const field = name.value.value; fields.add(field);
          const attrs = child.node.attributes.filter(t.isJSXAttribute);
          const requiredAttr = attrs.find(a => t.isJSXIdentifier(a.name, { name: 'required' }));
          if (requiredAttr && (!requiredAttr.value || (t.isJSXExpressionContainer(requiredAttr.value) && t.isBooleanLiteral(requiredAttr.value.expression, { value: true })))) required.add(field);
          if (attrs.some(a => t.isJSXIdentifier(a.name, { name: 'type' }) && t.isStringLiteral(a.value, { value: 'email' }))) emails.add(field);
        }
      }});
      const parsed = JSON.parse(config.value.value);
      for (const field of Array.isArray(parsed.extraFields) ? parsed.extraFields : []) if (typeof field === 'string') fields.add(field);
      forms[id.value.value] = { ...parsed, allowedFields: [...fields], requiredFields: [...required], emailFields: [...emails] };
    }});
  }
  return forms;
}

// Kept as a standalone server module, with no browser or editor dependency.
export const PORTABLE_FORM_HANDLER = `import { createSign } from 'node:crypto';

const json = (data, status = 200) => Response.json(data, { status });
const tokenUrl = 'https://oauth2.googleapis.com/token';
const base64url = (value) => Buffer.from(value).toString('base64url');

async function googleToken(env, fetcher) {
  const email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\\\n/g, '\\n');
  if (!email || !key) throw new Error('Google service account not configured');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + base64url(JSON.stringify({ iss: email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: tokenUrl, iat: now, exp: now + 3600 }));
  const signer = createSign('RSA-SHA256'); signer.update(unsigned); signer.end();
  const assertion = unsigned + '.' + signer.sign(key).toString('base64url');
  const response = await fetcher(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
  if (!response.ok) throw new Error('Google authorization failed');
  const data = await response.json();
  if (!data.access_token) throw new Error('Google authorization failed');
  return data.access_token;
}

async function sendSheet(dest, fields, env, fetcher) {
  if (!dest.sheetId || !dest.sheetName) throw new Error('Sheet destination not configured');
  const token = await googleToken(env, fetcher);
  const range = "'" + dest.sheetName.replace(/'/g, "''") + "'!A1:ZZ1";
  const endpoint = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(dest.sheetId) + '/values/';
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const lookup = await fetcher(endpoint + encodeURIComponent(range), { headers });
  if (!lookup.ok) throw new Error('Could not read sheet headers');
  const names = (await lookup.json()).values?.[0];
  if (!Array.isArray(names) || !names.length) throw new Error('Sheet headers missing');
  // Refuse a lossy write: do not invent or modify production headers.
  const sheetFields = dest.timestampField ? { ...fields, [dest.timestampField]: new Date().toISOString() } : fields;
  const missing = Object.keys(sheetFields).filter(name => !names.includes(name) && sheetFields[name] !== '');
  if (missing.length) throw new Error('Sheet is missing submitted field columns');
  const values = names.map(name => String(sheetFields[name] ?? ''));
  return async () => {
    const append = await fetcher(endpoint + encodeURIComponent(range) + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', { method: 'POST', headers, body: JSON.stringify({ values: [values] }) });
    if (!append.ok) throw new Error('Sheet append failed');
  };
}

async function sendEmail(dest, fields, env, fetcher) {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM || !dest.recipient) throw new Error('Email destination not configured');
  const text = [dest.body || 'New submission', '', ...Object.entries(fields).map(([key, value]) => key + ': ' + String(value))].join('\\n');
  const response = await fetcher('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: env.MAIL_FROM, to: [dest.recipient], subject: dest.subject || 'New submission', text }) });
  if (!response.ok) throw new Error('Email delivery failed');
}

export async function handleForm(req, configs, env = process.env, fetcher = fetch) {
  let body; try { body = await req.json(); } catch { return json({ ok: false, error: 'Invalid request' }, 400); }
  const config = typeof body?.formId === 'string' ? configs[body.formId] : null;
  if (!config || !Array.isArray(config.sendTo) || !config.sendTo.length || !body.fields || typeof body.fields !== 'object' || Array.isArray(body.fields)) return json({ ok: false, error: 'Invalid form' }, 400);
  if (body._hp) return json({ ok: true });
  const entries = Object.entries(body.fields);
  if (entries.length > 100 || entries.some(([key, value]) => !config.allowedFields?.includes(key) || key.length > 200 || typeof value !== 'string' || value.length > 10000)) return json({ ok: false, error: 'Invalid fields' }, 400);
  const fields = Object.fromEntries(entries);
  if ((config.requiredFields || []).some(name => typeof fields[name] !== 'string' || !fields[name].trim())) return json({ ok: false, error: 'Required fields missing' }, 400);
  if ((config.emailFields || []).some(name => fields[name] && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(fields[name]))) return json({ ok: false, error: 'Invalid email' }, 400);
  try {
    const delivery = [];
    // Prepare every sheet before delivering anything, including checking its headers.
    for (const dest of config.sendTo) {
      if (dest.type === 'email') {
        if (!env.RESEND_API_KEY || !env.MAIL_FROM || !dest.recipient) throw new Error('Email destination not configured');
        delivery.push(() => sendEmail(dest, fields, env, fetcher));
      } else if (dest.type === 'sheet') delivery.push(await sendSheet(dest, fields, env, fetcher));
      else throw new Error('Unsupported destination');
    }
    for (const deliver of delivery) await deliver();
    const redirect = typeof config.redirect === 'string' && config.redirect.startsWith('/') && !config.redirect.startsWith('//') ? config.redirect : undefined;
    return json({ ok: true, redirect });
  } catch { return json({ ok: false, error: 'Delivery unavailable' }, 502); }
}
`;

export function makePortableFormFiles(configs: Record<string, unknown>): Record<string, string> {
  return {
    'app/api/form/route.js': `// AUTO-GENERATED by Revyme — portable form route.
import { handleForm } from './handler.mjs';\nimport configs from './forms.json';\nexport const runtime = 'nodejs';\nexport function POST(req) { return handleForm(req, configs); }\n`,
    'app/api/form/handler.mjs': PORTABLE_FORM_HANDLER,
    'app/api/form/forms.json': JSON.stringify(configs, null, 2),
  };
}
