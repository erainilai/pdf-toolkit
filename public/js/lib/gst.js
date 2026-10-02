/* GST helpers shared by the browser form and the server-side invoice renderer. */

export const GST_STATES = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
  '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka',
  '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
  '97': 'Other Territory',
};

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Validates format + the mod-36 check digit used by the GST network. */
export function validateGstin(gstin) {
  const g = String(gstin || '').trim().toUpperCase();
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return { valid: false, reason: 'format' };
  if (!GST_STATES[g.slice(0, 2)]) return { valid: false, reason: 'state code' };
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = GSTIN_CHARS.indexOf(g[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  const check = GSTIN_CHARS[(36 - (sum % 36)) % 36];
  return check === g[14] ? { valid: true, stateCode: g.slice(0, 2) } : { valid: false, reason: 'check digit' };
}

