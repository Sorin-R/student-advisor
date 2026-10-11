// This module is deliberately dependency-free so browser and API use the same contract.
export const TERMS_VERSION = '2026-10-10'
export const DOCUMENT_KEYS = Object.freeze(['passport', 'transcript', 'personalStatement', 'proofAddress', 'reference'])
export const APPLICATION_FIELDS = Object.freeze({
  title: 30, firstName: 100, lastName: 100, email: 254, phoneCountry: 2, phone: 32,
  dob: 10, nationality: 100, countryOfBirth: 100, country: 100,
  homeAddress: 500, address: 500, addressPlaceId: 255, city: 150, postalCode: 32,
  nextOfKinName: 200, nextOfKinPhone: 32, school: 200, schoolCountry: 100,
  qualification: 100, graduationYear: 4, englishTest: 100, englishScore: 32,
  university: 250, course: 250, level: 50, intake: 80, budget: 80,
  employment: 2000, motivation: 6000, supportNeeds: 200,
  passport: 180, transcript: 180, personalStatement: 180, proofAddress: 180,
  reference: 180,
})
export const REQUIRED_APPLICATION_FIELDS = Object.freeze([
  'title', 'firstName', 'lastName', 'email', 'phoneCountry', 'phone', 'dob', 'nationality',
  'countryOfBirth', 'country', 'homeAddress', 'city', 'postalCode',
  'nextOfKinName', 'nextOfKinPhone', 'school', 'schoolCountry', 'qualification',
  'graduationYear', 'englishTest', 'university', 'course', 'level', 'intake',
])
export const MAX_APPLICATION_BYTES = 32 * 1024
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length

export function sanitizeApplicationData(value) {
  if (typeof value === 'string') {
    if (value.length > 1024 * 1024) return {}
    try { value = JSON.parse(value) } catch { return {} }
  }
  if (!record(value)) return {}
  const data = {}
  for (const [key, length] of Object.entries(APPLICATION_FIELDS)) {
    if (typeof value[key] === 'string') data[key] = value[key].replace(CONTROL_CHARACTERS, '').trim().slice(0, length)
  }
  if (typeof value.termsAccepted === 'boolean') data.termsAccepted = value.termsAccepted
  return data
}

export function validateApplicationData(value, { submitted = false, now = new Date() } = {}) {
  const errors = []
  if (!record(value)) return { data: {}, errors: ['Application data must be an object.'] }
  if (bytes(value) > MAX_APPLICATION_BYTES) errors.push('Application data exceeds the 32 KB limit.')
  for (const key of Object.keys(value)) {
    if (key === 'termsAccepted') {
      if (typeof value[key] !== 'boolean') errors.push('termsAccepted must be true or false.')
    } else if (!Object.hasOwn(APPLICATION_FIELDS, key)) errors.push(`Unknown application field: ${key.slice(0, 60)}.`)
    else if (typeof value[key] !== 'string') errors.push(`${key} must be text.`)
    else if (value[key].length > APPLICATION_FIELDS[key]) errors.push(`${key} is too long.`)
  }
  const data = sanitizeApplicationData(value)
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.push('Enter a valid email address.')
  if (data.phoneCountry && !/^[A-Z]{2}$/.test(data.phoneCountry)) errors.push('Choose a valid phone country.')
  const validPhone = (value) => /^\+?[\d\s().-]{6,32}$/.test(value) && /^\d{6,15}$/.test(value.replace(/\D/g, ''))
  if (data.phone && !validPhone(data.phone)) errors.push('Enter a valid phone number.')
  if (data.nextOfKinPhone && !validPhone(data.nextOfKinPhone)) errors.push('Enter a valid emergency contact phone number.')
  if (data.dob) {
    const date = new Date(`${data.dob}T00:00:00.000Z`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.dob) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== data.dob || date > now || date.getUTCFullYear() < 1900) errors.push('Enter a valid date of birth.')
  }
  if (data.graduationYear && (!/^\d{4}$/.test(data.graduationYear) || +data.graduationYear < 1950 || +data.graduationYear > now.getUTCFullYear() + 10)) errors.push('Enter a valid graduation year.')
  if (data.level && !['Foundation', 'Undergraduate', 'Postgraduate'].includes(data.level)) errors.push('Choose a valid study level.')
  if (data.englishTest === 'Born in UK and studied in UK' && data.nationality !== 'United Kingdom' && data.schoolCountry !== 'United Kingdom') errors.push('The English-test exemption requires a UK nationality or UK school.')
  if (submitted) {
    for (const key of REQUIRED_APPLICATION_FIELDS) if (!data[key]) errors.push(`${key} is required before submission.`)
    if (data.termsAccepted !== true) errors.push('Accept the Terms & Conditions before submitting.')
  }
  return { data, errors }
}

export function applicationProgress(value) {
  const data = sanitizeApplicationData(value)
  return Math.round(REQUIRED_APPLICATION_FIELDS.filter((key) => Boolean(data[key])).length / REQUIRED_APPLICATION_FIELDS.length * 100)
}
