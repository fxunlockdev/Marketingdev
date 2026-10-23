// Railway settings are operator input, never authority to replace infrastructure credentials.
const keys = ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'HIGGSFIELD_CREDENTIALS'];
export function providerSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('INVALID_PROVIDER_SETTINGS');
  const output = {};
  for (const key of keys) {
    const value = input[key];
    if (value === undefined || value === '') continue;
    if (typeof value !== 'string' || value.length > 8192 || /[\r\n\0]/.test(value) || value !== value.trim()) {
      throw Error('INVALID_PROVIDER_SETTINGS');
    }
    output[key] = value;
  }
  return output;
}
