/**
 * Generate a TOTP secret for the admin login (2FA is mandatory for ADMIN_PASSWORD).
 *   pnpm --filter @usdt-trx/core totp:setup [--account admin]
 * Add the printed secret to .env as ADMIN_TOTP_SECRET (or as the third field of an ADMIN_TOKENS entry) and the
 * otpauth URI to your authenticator app (Google Authenticator, Aegis, 1Password, ...). Nothing is stored anywhere.
 */
import { generateTotpSecret, otpauthUri, totp } from '../common/totp.js';

const i = process.argv.indexOf('--account');
const account = i >= 0 ? process.argv[i + 1] : 'admin';
const secret = generateTotpSecret();
console.log(`ADMIN_TOTP_SECRET=${secret}`);
console.log(`otpauth URI (paste into the authenticator, or enter the secret manually): ${otpauthUri(secret, account)}`);
console.log(`current code (to check the app is in sync): ${totp(secret)}`);
