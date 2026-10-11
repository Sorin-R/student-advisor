import { Component, StrictMode, Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Helmet, HelmetProvider } from 'react-helmet-async'
import { useTranslation } from 'react-i18next'
import './styles.css'
import './portal.css'
import './frontend-overrides.css'
import './content.css'
import './theme.css'
import ThemeToggle, { ThemeProvider } from './ThemeToggle'
import { loadTranslations } from './i18n'
import { EditorialPage, HomeFaq, LanguageSwitcher } from './PublicContent'
import { EditableImage, EditableInlineImage, EditableText, SiteEditorProvider, useSiteEditor } from './SiteEditor'
const BlogArticle = lazy(() => import('./Blog').then(module => ({ default: module.BlogArticle })))
const BlogIndex = lazy(() => import('./Blog').then(module => ({ default: module.BlogIndex })))
import { ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from './AuthPages'
const AdminDashboard = lazy(() => import('./AdminDashboard'))
import AccountSecurity, { SignInPanel, useSession, useSessionBootstrap } from './AccountSecurity'
import { api, apiFetch as fetch, getSession, logout, refreshSession } from './api'
import PrivacyPage from './PrivacyPage'
import { selectedDocumentUploads } from './application-client'
import { TERMS_VERSION, validateApplicationData, applicationProgress as calculateApplicationProgress } from '../shared/application-schema'
import { universities, universityFromPath, universitySlug } from './universities'
import { localizedPath } from './locale-routes'
import { CONTENT_REVIEWED, organization, SITE_NAME, SITE_URL, SOCIAL_IMAGE } from './content-catalog'
const pathways = [['01', 'Tell us your plans', 'Share what you want to study, where you would like to live and what matters most to you.'], ['02', 'Get clear guidance', 'An adviser helps you understand universities, entry requirements and your next best step.'], ['03', 'Apply with support', 'Get practical, friendly support when you are ready to move forward with your application.']]
const homeImages = {
  heroPrimary: 'https://images.unsplash.com/photo-1564981797816-1043664bf78d?auto=format&fit=crop&fm=webp&w=900&q=85',
  heroSecondary: 'https://images.unsplash.com/photo-1541339907198-e08756dedf3f?auto=format&fit=crop&fm=webp&w=700&q=85',
  story: 'https://images.unsplash.com/photo-1523580846011-d3a5bc25702b?auto=format&fit=crop&fm=webp&w=1200&q=85',
}
const countryCodes = ['AF','AL','DZ','AD','AO','AG','AR','AM','AU','AT','AZ','BS','BH','BD','BB','BY','BE','BZ','BJ','BT','BO','BA','BW','BR','BN','BG','BF','BI','CV','KH','CM','CA','CF','TD','CL','CN','CO','KM','CG','CD','CR','CI','HR','CU','CY','CZ','DK','DJ','DM','DO','EC','EG','SV','GQ','ER','EE','SZ','ET','FJ','FI','FR','GA','GM','GE','DE','GH','GR','GD','GT','GN','GW','GY','HT','HN','HU','IS','IN','ID','IR','IQ','IE','IL','IT','JM','JP','JO','KZ','KE','KI','KW','KG','LA','LV','LB','LS','LR','LY','LI','LT','LU','MG','MW','MY','MV','ML','MT','MH','MR','MU','MX','FM','MD','MC','MN','ME','MA','MZ','MM','NA','NR','NP','NL','NZ','NI','NE','NG','KP','MK','NO','OM','PK','PW','PS','PA','PG','PY','PE','PH','PL','PT','QA','RO','RU','RW','KN','LC','VC','WS','SM','ST','SA','SN','RS','SC','SL','SG','SK','SI','SB','SO','ZA','KR','SS','ES','LK','SD','SR','SE','CH','SY','TJ','TZ','TH','TL','TG','TO','TT','TN','TR','TM','TV','UG','UA','AE','GB','US','UY','UZ','VU','VA','VE','VN','YE','ZM','ZW']
const countryDialCodes = { GB: '+44', US: '+1', CA: '+1', AU: '+61', NZ: '+64', IE: '+353', FR: '+33', DE: '+49', ES: '+34', IT: '+39', PT: '+351', NL: '+31', BE: '+32', CH: '+41', AT: '+43', PL: '+48', RO: '+40', BG: '+359', GR: '+30', TR: '+90', IN: '+91', CN: '+86', JP: '+81', KR: '+82', SG: '+65', MY: '+60', TH: '+66', AE: '+971', SA: '+966', ZA: '+27', NG: '+234', KE: '+254', BR: '+55', MX: '+52', AR: '+54', CL: '+56', CO: '+57' }
const countryNames = new Intl.DisplayNames(['en'], { type: 'region' })
const countries = countryCodes.map((code) => ({ code, name: countryNames.of(code), dialCode: countryDialCodes[code] || '' })).sort((a, b) => a.name.localeCompare(b.name))
const countryOptions = countries.map((country) => country.name)
const countryByName = Object.fromEntries(countries.map((country) => [country.name, country]))
const graduationYears = Array.from({ length: 81 }, (_, index) => String(1950 + index))
const preferredIntakes = ['2026', '2027'].flatMap((year) => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((month) => `${month} ${year}`))
function currentApplicationStage(date = new Date(), language = 'en') {
  const month = date.getMonth()
  const year = date.getFullYear()
  const seasons = language.startsWith('ro')
    ? { autumn: 'toamna', winter: 'iarna', spring: 'primăvara', summer: 'vara' }
    : { autumn: 'Autumn', winter: 'Winter', spring: 'Spring', summer: 'Summer' }
  if (month >= 8 && month <= 10) return `${seasons.autumn} ${year}`
  if (month === 11 || month <= 1) return `${seasons.winter} ${month === 11 ? year + 1 : year}`
  if (month >= 2 && month <= 4) return `${seasons.spring} ${year}`
  return `${seasons.summer} ${year}`
}
function userDisplayName(user) {
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim()
  return name || user?.email || 'Student'
}

const applicationSections = [
  { id: 'personal', title: 'Personal details', fields: ['title', 'firstName', 'lastName', 'email', 'phone', 'dob', 'nationality', 'countryOfBirth', 'country', 'homeAddress', 'city', 'postalCode', 'nextOfKinName', 'nextOfKinPhone'] },
  { id: 'education', title: 'Education & English', fields: ['school', 'schoolCountry', 'qualification', 'graduationYear', 'englishTest', 'englishScore'] },
  { id: 'choices', title: 'University choices', fields: ['university', 'course', 'level', 'intake'] },
  { id: 'experience', title: 'Experience & statement', fields: ['employment', 'motivation', 'supportNeeds'] },
  { id: 'documents', title: 'Documents & reference', fields: ['passport', 'transcript', 'reference'] },
]
const portalRomanian = {
  application: 'Aplicația lui {{name}}', signOut: 'Deconectare', application2027: 'APLICAȚIE 2027', yourProgress: 'Progresul tău.', complete: 'finalizat', progressCopy: 'Completează formularul, salvează o ciornă sau trimite aplicația când ești pregătit.', newApplication: 'Aplicație nouă', savedApplications: 'Aplicații salvate', submittedApplications: 'Aplicații trimise', needHelp: 'Ai nevoie de ajutor?', askAdvisor: 'Întreabă consilierul', studentApplication: 'APLICAȚIE STUDENT', takeStep: 'Fă pas cu pas.', processingComplete: '✓ Procesarea este finalizată', locked: 'Aplicația ta este blocată. Cere consilierului să o redeschidă dacă ai nevoie de modificări.', documentsRequested: 'Documente solicitate de consilier — încarcă acum', personal: 'Date personale', personalCopy: 'Spune-ne cine ești și cum te putem contacta.', education: 'Educație și engleză', educationCopy: 'Pregătirea ta academică și nivelul de limba engleză.', choices: 'Opțiuni de universitate', choicesCopy: 'Alege cursul și sesiunea pentru care dorești sprijin.', experience: 'Experiență și motivație', experienceCopy: 'Opțional — spune-ne mai multe despre obiectivele tale.', documents: 'Documente solicitate de consilier', documentsCopy: 'Încarcă documentele solicitate și trimite-le pentru verificare.', title: 'Titlu', firstName: 'Prenume', lastName: 'Nume', email: 'Adresă de e-mail', phoneCountry: 'Țara telefonului', selectCountry: 'Alege o țară', phoneNumber: 'Număr de telefon', birthDate: 'Data nașterii', nationality: 'Naționalitate', birthCountry: 'Țara nașterii', residenceCountry: 'Țara de reședință', homeAddress: 'Număr și stradă', city: 'Oraș', postalCode: 'Cod poștal', nextOfKinName: 'Numele persoanei de contact în caz de urgență', nextOfKinPhone: 'Telefonul persoanei de contact în caz de urgență', optional: '(opțional)', cityPlaceholder: 'Începe să scrii adresa și alege un rezultat Google Maps', school: 'Școală sau colegiu', schoolCountry: 'Țara școlii sau colegiului', qualification: 'Cea mai înaltă calificare', graduationYear: 'Anul absolvirii', englishTest: 'Test de engleză', score: 'Scor total (dacă este disponibil)', preferredUniversity: 'Universitatea preferată', preferredCourse: 'Cursul preferat', studyLevel: 'Nivel de studiu', preferredIntake: 'Sesiunea preferată', employment: 'Loc de muncă sau voluntariat', support: 'De ce sprijin ai nevoie?', whyCourse: 'De ce vrei să studiezi acest curs?', motivationPlaceholder: 'Spune-ne despre interesele, obiectivele și experiența ta...', terms: 'Am citit și sunt de acord cu', termsLink: 'Termenii și condițiile', termsRequired: 'Trebuie să accepți Termenii și condițiile înainte de a trimite aplicația.', saveApplication: 'Salvează aplicația', submitReady: 'Trimite când ești pregătit', selectOption: 'Alege o opțiune', sectionPersonal: 'Date personale', sectionEducation: 'Educație și engleză', sectionChoices: 'Opțiuni de universitate', sectionExperience: 'Experiență și motivație', sectionDocuments: 'Documente și recomandări'
}
function usePortalText() {
  const { i18n } = useTranslation()
  return (key, fallback) => i18n.language?.startsWith('ro') ? (portalRomanian[key] || fallback) : fallback
}
function portalSectionTitle(pt, section) { return pt(`section${section.id[0].toUpperCase()}${section.id.slice(1)}`, section.title) }

const documentCatalog = [
  ['passport', 'Passport or Identity document'],
  ['transcript', 'Academic transcript or certificate'],
  ['personalStatement', 'Personal Statement'],
  ['proofAddress', 'Proof of address'],
  ['reference', 'Teacher or employer reference'],
]
function documentReviewLabel(status) { return ({ pending: 'Waiting for student', submitted: 'Submitted for review', accepted: 'Accepted', rejected: 'Resubmission requested' }[status] || 'Waiting for student') }

function AccessibleDialog({ title, onClose, children }) {
  const dialog = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const previous = document.activeElement
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.current?.focus()
    const keydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); return }
      if (event.key !== 'Tab') return
      const controls = [...(dialog.current?.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]') || [])]
      if (!controls.length) { event.preventDefault(); return }
      const first = controls[0], last = controls[controls.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = overflow; previous?.focus?.() }
  }, [])
  return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose() }}><div ref={dialog} className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>{children}</div></div>
}

function SupportModal({ user, onClose }) {
  const { i18n } = useTranslation()
  const ro = i18n.resolvedLanguage?.startsWith('ro')
  const copy = ro ? {
    eyebrow: 'Hai să vorbim', title: 'Cu ce te putem ajuta?', intro: 'Spune-ne puțin despre planurile tale, iar noi te vom ajuta să găsești drumul potrivit.',
    name: 'Numele tău', email: 'Adresa de e-mail', topic: 'Cu ce ai dori ajutor?', select: 'Alege o opțiune', message: 'Mesaj', send: 'Trimite solicitarea', close: 'Închide',
    sent: 'Mesajul tău a fost trimis.', sending: 'Se trimite…', failed: 'Nu am putut trimite mesajul. Încearcă din nou.', namePlaceholder: 'de exemplu, Alex Smith', messagePlaceholder: 'Spune-ne cum te putem ajuta…',
    topics: ['Alegerea universității', 'Găsirea cursului potrivit', 'Sprijin pentru aplicație', 'Pregătirea documentelor'],
  } : {
    eyebrow: 'Let’s talk', title: 'What’s on your mind?', intro: 'Tell us a little about your plans and we’ll help you find a way forward.',
    name: 'Your name', email: 'Email address', topic: 'What would you like help with?', select: 'Select an option', message: 'Message', send: 'Send my enquiry', close: 'Close',
    sent: 'Your message has been sent.', sending: 'Sending…', failed: 'Unable to send your message. Please try again.', namePlaceholder: 'e.g. Alex Smith', messagePlaceholder: 'Tell us how we can help...',
    topics: ['Choosing a university', 'Finding the right course', 'Application support', 'Document preparation'],
  }
  const [messageForm, setMessageForm] = useState({ name: [user?.firstName, user?.lastName].filter(Boolean).join(' '), email: user?.email || '', topic: '', message: '' })
  const [status, setStatus] = useState('')
  const submit = async event => { event.preventDefault(); if (status === 'sending') return; setStatus('sending'); try { await api('/api/support-messages', { method: 'POST', body: messageForm }); setStatus('sent') } catch (error) { setStatus(error.message) } }
  const updateMessage = (key, value) => setMessageForm((current) => ({ ...current, [key]: value }))
  return <AccessibleDialog title={copy.title} onClose={onClose}><button className="close" aria-label={copy.close} onClick={onClose}>×</button><p className="eyebrow">{copy.eyebrow}</p><h2>{copy.title}</h2><p className="modal-intro">{copy.intro}</p>{status === 'sent' ? <div className="success"><div className="success-icon">✓</div><p>{copy.sent}</p><button className="button button-dark" onClick={onClose}>{copy.close}</button></div> : <form onSubmit={submit}><label>{copy.name}<input required value={messageForm.name} onChange={(event) => updateMessage('name', event.target.value)} placeholder={copy.namePlaceholder} /></label><label>{copy.email}<input required type="email" value={messageForm.email} onChange={(event) => updateMessage('email', event.target.value)} placeholder="you@example.com" /></label><label>{copy.topic}<select required value={messageForm.topic} onChange={(event) => updateMessage('topic', event.target.value)}><option value="">{copy.select}</option>{copy.topics.map((topic) => <option key={topic}>{topic}</option>)}</select></label><label>{copy.message}<textarea required value={messageForm.message} onChange={(event) => updateMessage('message', event.target.value)} placeholder={copy.messagePlaceholder} /></label>{status && status !== 'sending' && <p className="form-error" role="alert">{status}</p>}<button className="button button-dark full" disabled={status === 'sending'} type="submit">{status === 'sending' ? copy.sending : copy.send}</button><p className="privacy-link"><Link to="/privacy">Privacy notice</Link></p></form>}</AccessibleDialog>
}

function ApplicationForm({ form, update, save, notice, addressRef, requestedDocuments, documentStatus, documentStatusText, selectDocumentFile, sendDocuments, displayDocuments, locked, busy = false }) {
  const pt = usePortalText()
  const field = (label, key, type = 'text', placeholder = '', required = false) => <label className="portal-field"><EditableText embedded field={`form.${key}.label`} label={`Form label: ${key}`}>{label}</EditableText><input required={required} type={type} value={form[key] || ''} onChange={(event) => { update(key, event.target.value); if (key === 'homeAddress') update('addressPlaceId', '') }} placeholder={placeholder} /></label>
  const choice = (label, key, options, required = false, disabledOptions = [], disabled = false) => <label className="portal-field"><EditableText embedded field={`form.${key}.label`} label={`Form label: ${key}`}>{label}</EditableText><select required={required} disabled={disabled} value={form[key] || ''} onChange={(event) => update(key, event.target.value)}><option value="">{pt('selectOption', 'Select an option')}</option>{options.map((option) => <option key={option} disabled={disabledOptions.includes(option)}>{option}</option>)}</select></label>
  const phoneCountry = countries.find((country) => country.code === (form.phoneCountry || 'GB'))
  const englishExempt = form.nationality === 'United Kingdom' || form.schoolCountry === 'United Kingdom'
  const englishOptions = ['IELTS Academic', 'TOEFL iBT', 'Cambridge English', 'Duolingo English Test', 'Born in UK and studied in UK', 'Not taken yet']
  const englishDisabled = englishExempt ? englishOptions.filter((option) => option !== 'Born in UK and studied in UK') : []
  const documentsNeedAttention = displayDocuments && requestedDocuments.some((key) => !['submitted', 'accepted'].includes(documentStatus(key)))
  useEffect(() => { if (englishExempt && form.englishTest !== 'Born in UK and studied in UK') update('englishTest', 'Born in UK and studied in UK') }, [englishExempt])
  return <><fieldset disabled={locked || busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
    {locked && <div className="application-status-banner complete"><strong>{pt('processingComplete', '✓ Processing is complete')}</strong><span>{pt('locked', 'Your application is locked. Ask your adviser to reopen it if you need to make changes.')}</span></div>}
    {documentsNeedAttention && <div className="requested-documents-notice"><button onClick={() => document.getElementById('application-documents')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{pt('documentsRequested', 'Documents requested by your adviser — upload now')}</button></div>}
    {notice && <div className="application-notice" role="status">{notice}</div>}
    <div className="application-heading"><div><p className="eyebrow">{pt('studentApplication', 'Student application')}</p><h2>{pt('takeStep', 'Take it one step at a time.')}</h2></div></div>
    <section className="form-section" id="application-personal"><div className="form-section-heading"><span>01</span><div><h3>{pt('personal', 'Personal details')}</h3><p>{pt('personalCopy', 'Tell us who you are and how we can contact you.')}</p></div></div><div className="portal-form-grid">
      {choice(pt('title', 'Title'), 'title', ['Mr', 'Mrs', 'Miss', 'Ms', 'Mx', 'Dr', 'Prof', 'Prefer not to say'], true)}{field(pt('firstName', 'First name'), 'firstName', 'text', 'e.g. Alex', true)}{field(pt('lastName', 'Last name'), 'lastName', 'text', 'e.g. Smith', true)}{field(pt('email', 'Email address'), 'email', 'email', 'you@example.com', true)}
      <label className="portal-field">{pt('phoneCountry', 'Phone country')}<select required value={form.phoneCountry || 'GB'} onChange={(event) => update('phoneCountry', event.target.value)}><option value="">{pt('selectCountry', 'Select a country')}</option>{countries.filter((country) => country.dialCode).map((country) => <option key={country.code} value={country.code}>{country.name} ({country.dialCode})</option>)}</select></label>
      {field(`${pt('phoneNumber', 'Phone number')} ${phoneCountry?.dialCode || ''}`, 'phone', 'tel', '7700 900000', true)}{field(pt('birthDate', 'Date of birth'), 'dob', 'date', '', true)}{choice(pt('nationality', 'Nationality'), 'nationality', countryOptions, true)}{choice(pt('birthCountry', 'Country of birth'), 'countryOfBirth', countryOptions, true)}{choice(pt('residenceCountry', 'Country of residence'), 'country', countryOptions, true)}
      <label className="portal-field full-field">{pt('homeAddress', 'Home address number and street')}<input required ref={addressRef} value={form.homeAddress || ''} onChange={(event) => { update('homeAddress', event.target.value); update('addressPlaceId', '') }} placeholder={pt('cityPlaceholder', 'Start typing your address and choose a result')} /></label>
      {field(pt('city', 'City'), 'city', 'text', 'e.g. London', true)}{field(pt('postalCode', 'Postal code'), 'postalCode', 'text', 'e.g. E13 9PZ', true)}{field(pt('nextOfKinName', 'Next of Kin/Emergency Contact Name'), 'nextOfKinName', 'text', 'e.g. Alex Smith', true)}{field(pt('nextOfKinPhone', 'Next of Kin Phone number'), 'nextOfKinPhone', 'tel', '+44 7700 900000', true)}
    </div></section>
    <section className="form-section" id="application-education"><div className="form-section-heading"><span>02</span><div><h3>{pt('education', 'Education & English')}</h3><p>{pt('educationCopy', 'Your academic background and English-language readiness.')}</p></div></div><div className="portal-form-grid">
      {field(pt('school', 'School or college'), 'school', 'text', 'Name of your school', true)}{choice(pt('schoolCountry', 'School or college country'), 'schoolCountry', countryOptions, true)}{choice(pt('qualification', 'Highest qualification'), 'qualification', ['A levels', 'IB Diploma', 'European Baccalaureate', 'High school diploma', 'Undergraduate degree', 'Other'], true)}{choice(pt('graduationYear', 'Graduation year'), 'graduationYear', graduationYears, true)}{choice(pt('englishTest', 'English test'), 'englishTest', englishOptions, true, englishDisabled, englishExempt)}{field(pt('score', 'Overall score (if available)'), 'englishScore', 'text', 'e.g. 7.0')}
    </div></section>
    <section className="form-section" id="application-choices"><div className="form-section-heading"><span>03</span><div><h3>{pt('choices', 'University choices')}</h3><p>{pt('choicesCopy', 'Choose the course and intake you want us to support.')}</p></div></div><div className="portal-form-grid">
      {choice(pt('preferredUniversity', 'Preferred university'), 'university', universities.map((uni) => uni.name), true)}{field(pt('preferredCourse', 'Preferred course'), 'course', 'text', 'e.g. Computer Science', true)}{choice(pt('studyLevel', 'Study level'), 'level', ['Foundation', 'Undergraduate', 'Postgraduate'], true)}{choice(pt('preferredIntake', 'Preferred intake'), 'intake', preferredIntakes, true)}
    </div></section>
    <section className="form-section" id="application-experience"><div className="form-section-heading"><span>04</span><div><h3>{pt('experience', 'Experience & statement')}</h3><p>{pt('experienceCopy', 'Optional — share more about your goals if you’d like.')}</p></div></div><div className="portal-form-grid">{field(pt('employment', 'Employment or volunteering'), 'employment', 'text', pt('optional', 'Optional'))}{choice(pt('support', 'What support do you need?'), 'supportNeeds', ['Choosing a course', 'Application review', 'Personal statement', 'Document preparation', 'Everything'])}<label className="portal-field full-field">{pt('whyCourse', 'Why do you want to study this course?')} <span className="field-optional">{pt('optional', '(optional)')}</span><textarea value={form.motivation || ''} onChange={(event) => update('motivation', event.target.value)} placeholder={pt('motivationPlaceholder', 'Tell us about your interests, goals and experience...')} /></label></div></section>
    {displayDocuments && requestedDocuments.length > 0 && <section className="form-section" id="application-documents"><div className="form-section-heading"><span>05</span><div><h3>Documents requested by your adviser</h3><p>Upload the requested documents and send them for review.</p></div></div><div className="document-list">{requestedDocuments.map((key) => { const document = documentCatalog.find(([documentKey]) => documentKey === key); if (!document) return null; return <label className="document-row" key={key}><span className={documentStatus(key) === 'rejected' ? 'document-check rejected' : form[key] ? 'document-check checked' : 'document-check'}>{documentStatus(key) === 'rejected' ? '!' : form[key] ? '✓' : '↑'}</span><span><strong>{document[1]}</strong><small className={`document-status ${documentStatus(key)}`}>{documentStatusText(key)} · PDF, JPG or PNG · max 10 MB</small></span><input type="file" accept=".pdf,.jpg,.jpeg,.png" disabled={['accepted', 'submitted'].includes(documentStatus(key))} onChange={(event) => selectDocumentFile(key, event.target.files[0])} /></label>})}</div>{requestedDocuments.some(key => !['accepted', 'submitted'].includes(documentStatus(key))) && <div className="form-actions"><button className="button button-dark" onClick={sendDocuments}>Send documents</button></div>}</section>}
    <div className="terms-acceptance"><label><input type="checkbox" checked={Boolean(form.termsAccepted)} onChange={(event) => update('termsAccepted', event.target.checked)} /> <span>{pt('terms', 'I have read and agree to the')} <a href="/terms" target="_blank" rel="noreferrer">{pt('termsLink', 'Terms & Conditions')}</a>.</span></label><p>{pt('termsRequired', 'You must accept the Terms & Conditions before submitting your application.')} <Link to="/privacy">Privacy notice</Link></p></div>
    <div className="form-actions"><button className="button button-dark" onClick={() => save('draft')}>{pt('saveApplication', 'Save application')}</button><button className="submit-application" onClick={() => save('submitted')}>{pt('submitReady', 'Submit when ready')}</button></div>
  </fieldset></>
}

function DashboardPortal({ setMode, selectedUniversity, onLogout, preview = false }) {
  const { user: sessionUser } = useSession()
  const currentUser = preview ? { firstName: 'Example', lastName: 'Student', email: '' } : sessionUser
  const pt = usePortalText()
  const initialForm = () => ({ firstName: currentUser?.firstName || '', lastName: currentUser?.lastName || '', email: currentUser?.email || '', phoneCountry: 'GB', university: selectedUniversity?.name || '', course: selectedUniversity?.courses?.[0] || '', level: 'Undergraduate', intake: 'September 2027' })
  const [form, setForm] = useState(initialForm)
  const [snapshot, setSnapshot] = useState(preview ? { id: null, status: 'draft', requestedDocuments: [] } : null)
  const [notice, setNotice] = useState('')
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [supportOpen, setSupportOpen] = useState(false)
  const [securityOpen, setSecurityOpen] = useState(false)
  const [documentFiles, setDocumentFiles] = useState({})
  const addressRef = useRef(null)
  const dirty = useRef(false)
  const busyRef = useRef(false)
  const version = useRef(0)
  const requestedDocuments = snapshot?.requestedDocuments || []
  const documentSubmissions = snapshot?.documentSubmissions || {}
  const locked = snapshot?.status === 'complete'
  const update = (key, value) => { dirty.current = true; setForm(current => ({ ...current, [key]: value })) }
  const applySnapshot = (result, replaceForm = false) => {
    setSnapshot(result)
    if (replaceForm || !dirty.current) {
      version.current = result.version || 0
      if (result.data) setForm(result.data)
      else if (replaceForm) setForm(initialForm())
    }
  }
  const load = async (replaceForm = false) => {
    if (preview) return
    const result = await api('/api/application')
    applySnapshot(result, replaceForm)
    setLoadError('')
    if (replaceForm) { dirty.current = false; setConflict(false); setDocumentFiles({}); setNotice('Latest application loaded.') }
    return result
  }
  useEffect(() => {
    if (preview) return
    let active = true
    const sync = async () => {
      if (busyRef.current || document.hidden) return
      try { const result = await api('/api/application'); if (active) { applySnapshot(result); setLoadError('') } } catch (error) { if (active) setLoadError(error.message) }
    }
    sync()
    const timer = window.setInterval(sync, 30000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])
  useEffect(() => {
    if (preview) return
    const warn = event => { if (dirty.current || Object.keys(documentFiles).length) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [documentFiles])
  useEffect(() => {
    if (preview) return
    const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
    if (!key || securityOpen) return
    let autocomplete
    let disposed = false
    const initialize = () => {
      if (disposed || !addressRef.current || !window.google?.maps?.places) return
      autocomplete = new window.google.maps.places.Autocomplete(addressRef.current, { types: ['address'], fields: ['place_id', 'formatted_address'] })
      autocomplete.addListener('place_changed', () => { const place = autocomplete.getPlace(); if (place.place_id) { update('homeAddress', place.formatted_address || addressRef.current.value); update('addressPlaceId', place.place_id) } })
    }
    let script = document.querySelector('script[data-google-places]')
    if (window.google?.maps?.places) initialize()
    else {
      if (!script) { script = document.createElement('script'); script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places`; script.async = true; script.dataset.googlePlaces = 'true'; document.head.appendChild(script) }
      script.addEventListener('load', initialize)
    }
    return () => { disposed = true; script?.removeEventListener('load', initialize); if (autocomplete) window.google.maps.event.clearInstanceListeners(autocomplete) }
  }, [securityOpen, Boolean(snapshot)])
  const mutationError = error => { if ([409, 428].includes(error.status)) setConflict(true); setNotice(error.message) }
  const save = async status => {
    if (preview) return
    if (busy || locked || !snapshot || conflict) return
    const validation = validateApplicationData(form, { submitted: status === 'submitted' || (snapshot?.status && snapshot.status !== 'draft') })
    if (validation.errors.length) { setNotice(validation.errors.join(' ')); return }
    setBusy(true); busyRef.current = true; setNotice('')
    try {
      const result = await api('/api/application', { method: 'PUT', body: { data: validation.data, status, version: version.current, termsVersion: TERMS_VERSION } })
      dirty.current = false; applySnapshot(result, true)
      setNotice(status === 'submitted' ? 'Application submitted successfully.' : 'Application saved successfully.')
    } catch (error) { mutationError(error) } finally { setBusy(false); busyRef.current = false }
  }
  const deleteApplication = async () => {
    if (preview) return
    if (busy || !snapshot?.id || locked || !window.confirm('Delete your application and its uploaded documents? This cannot be undone.')) return
    setBusy(true); busyRef.current = true; setNotice('')
    try { await api('/api/application', { method: 'DELETE', body: { version: version.current } }); dirty.current = false; setDocumentFiles({}); await load(true); setNotice('Your application has been deleted.') } catch (error) { mutationError(error) } finally { setBusy(false); busyRef.current = false }
  }
  const selectDocumentFile = (key, file) => {
    if (!file) return
    if (file.size > 10 * 1024 * 1024 || !file.size) return setNotice('Each document must be nonempty and no larger than 10 MB.')
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) return setNotice('Documents must be PDF, JPG or PNG files.')
    setDocumentFiles(current => ({ ...current, [key]: file })); setNotice('')
  }
  const readFile = file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('Unable to read the selected file.')); reader.readAsDataURL(file) })
  const sendDocuments = async () => {
    if (preview) return
    if (busy || locked || conflict) return
    const entries = selectedDocumentUploads(documentFiles, requestedDocuments, documentSubmissions)
    if (!entries.length) return setNotice('Select at least one new or replacement document to send.')
    setBusy(true); busyRef.current = true; setNotice('')
    try {
      for (const [key, file] of entries) {
        const result = await api('/api/application/documents', { method: 'PATCH', body: { version: version.current, documents: { [key]: { fileName: file.name, mimeType: file.type, content: await readFile(file) } } } })
        version.current = result.version
        setSnapshot(result)
        setDocumentFiles(current => { const next = { ...current }; delete next[key]; return next })
      }
      setNotice('Selected documents sent. Previously uploaded documents have been kept.')
    } catch (error) { mutationError(error) } finally { setBusy(false); busyRef.current = false }
  }
  const documentStatus = key => documentSubmissions[key]?.status || 'pending'
  const documentStatusText = key => documentFiles[key] ? `Selected: ${documentFiles[key].name}` : documentReviewLabel(documentStatus(key))
  const progress = calculateApplicationProgress(form)
  const visibleSections = applicationSections.filter(section => section.id !== 'documents' || requestedDocuments.length)
  const backHome = () => { if (!dirty.current && !Object.keys(documentFiles).length || window.confirm('Leave this page and discard unsaved changes?')) setMode('home') }
  return <div className="portal-page dashboard-page"><div className="portal-top"><button className="logo" data-preview-navigation onClick={backHome}><span>student</span><strong>advisor</strong><b>®</b></button><ThemeToggle /><div className="portal-nav"><div className="student-account-language"><LanguageSwitcher /></div><span>{userDisplayName(currentUser)}’s application</span><button data-preview-navigation onClick={() => setSecurityOpen(!securityOpen)}>Account security</button><button disabled={busy} onClick={onLogout}>{pt('signOut', 'Sign out')}</button></div></div><div className="portal-layout"><aside className="progress-sidebar"><p className="eyebrow">Student application</p><h1>{pt('yourProgress', 'Your progress.')}</h1><div className="progress-ring" style={{ '--application-progress': `${progress}%` }}><strong>{progress}%</strong><span>{pt('complete', 'complete')}</span></div><p className="progress-copy">One application, saved securely to your account. Keep your current application updated.</p><nav className="section-nav">{visibleSections.map(section => <button key={section.id} onClick={() => { setSecurityOpen(false); window.setTimeout(() => document.getElementById(`application-${section.id}`)?.scrollIntoView({ behavior: 'smooth' }), 0) }}>{portalSectionTitle(pt, section)}</button>)}</nav><button className="advisor-help" onClick={() => setSupportOpen(true)}>{pt('needHelp', 'Need help?')} <u>{pt('askAdvisor', 'Ask your advisor')}</u></button></aside><main className="application-main">{securityOpen ? <AccountSecurity preview={preview} onClose={() => setSecurityOpen(false)} /> : <>{loadError && <div role="alert" className="request-status">{loadError}<button onClick={() => load().catch(error => setLoadError(error.message))}>Retry loading application</button></div>}{!snapshot ? <p role="status">Loading your application…</p> : <>{snapshot.id && <p className="application-status-banner">Status: {({ draft: 'Draft', submitted: 'Awaiting adviser review', in_review: 'In review', complete: 'Processing complete', offer_received: 'Offer received' })[snapshot.status] || snapshot.status}</p>}{conflict && <div role="alert" className="request-status"><p>The application changed on the server. Your unsaved entries remain on this page. Copy anything you need before loading the latest version.</p><button onClick={() => { if (window.confirm('Discard unsaved entries and load the latest application?')) load(true).catch(mutationError) }}>Load latest application</button></div>}<ApplicationForm form={form} update={update} save={save} notice={notice} addressRef={addressRef} requestedDocuments={requestedDocuments} documentStatus={documentStatus} documentStatusText={documentStatusText} selectDocumentFile={selectDocumentFile} sendDocuments={sendDocuments} displayDocuments={requestedDocuments.length > 0} locked={locked} busy={busy || conflict} /><div className="single-application-actions">{snapshot.id && !locked && <button disabled={busy || conflict} className="delete-application" onClick={deleteApplication}>Delete application</button>}</div><p className="privacy-link">Read our <Link to="/privacy">privacy notice</Link> for information about your application and documents.</p></>}</>}</main></div>{supportOpen && <SupportModal user={currentUser} onClose={() => setSupportOpen(false)} />}</div>
}

function applicationProgress(data = {}) { return calculateApplicationProgress(data) }

function AdvisorMessagesPage({ token, onBack, onSignOut, signOutError }) {
  const [messages, setMessages] = useState([])
  const [selectedMessage, setSelectedMessage] = useState(null)
  const [page, setPage] = useState(1)
  const [meta, setMeta] = useState({ total: 0, hasMore: false })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    const load = async () => { try { const result = await api(`/api/advisor/support-messages?page=${page}&limit=25`); if (active) { setMessages(result.messages || []); setMeta(result); setError('') } } catch (err) { if (active) setError(err.message) } }
    load(); const timer = window.setInterval(load, 30000)
    return () => { active = false; window.clearInterval(timer) }
  }, [page, token])
  const openMessage = async message => {
    setSelectedMessage(message)
    if (message.readAt) return
    setBusy(true)
    try { await api(`/api/advisor/support-messages/${message.id}/read`, { method: 'PATCH' }); setMessages(items => items.map(item => item.id === message.id ? { ...item, readAt: new Date().toISOString() } : item)) } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return <div className="portal-page adviser-page"><div className="portal-top"><Link className="logo" to="/"><span>student</span><strong>advisor</strong><b>®</b></Link><ThemeToggle /><div className="portal-nav"><span>Adviser messages</span><button onClick={onSignOut}>Sign out</button></div></div><main className="adviser-main messages-page">{signOutError && <p role="alert" className="form-error">{signOutError}</p>}<button className="documents-back-link" onClick={onBack}>Back to applications</button><div className="adviser-heading"><h1>Student<br /><em>messages.</em></h1><span>{meta.total} messages</span></div>{error && <p role="alert" className="form-error">{error}</p>}<div className="messages-layout"><section className="messages-list">{messages.map(message => <button disabled={busy} className={`${selectedMessage?.id === message.id ? 'message-row active' : 'message-row'}${message.readAt ? '' : ' unread'}`} key={message.id} onClick={() => openMessage(message)}><span className="message-avatar">{message.name?.[0]?.toUpperCase() || '?'}</span><span><strong>{message.name}</strong><small>{message.topic}</small><em>{new Date(message.createdAt).toLocaleString()}</em></span></button>)}{!messages.length && <p>No messages on this page.</p>}</section><section className="message-reader">{selectedMessage ? <><p className="eyebrow">{selectedMessage.topic}</p><h2>{selectedMessage.name}</h2><p className="message-meta">{selectedMessage.email} · {new Date(selectedMessage.createdAt).toLocaleString()}</p><div className="message-body">{selectedMessage.message}</div></> : <p>Select a message to read it.</p>}</section></div><div className="pagination"><button disabled={page === 1} onClick={() => { setSelectedMessage(null); setPage(page - 1) }}>Previous</button><span>Page {page}</span><button disabled={!meta.hasMore} onClick={() => { setSelectedMessage(null); setPage(page + 1) }}>Next</button></div></main></div>
}
function AdvisorMessageBadge({ token }) {
  const [count, setCount] = useState(0)
  useEffect(() => { let active = true; const load = () => api('/api/advisor/support-messages?page=1&limit=1').then(result => { if (active) setCount(result.unreadCount || 0) }).catch(() => {}); load(); const timer = window.setInterval(load, 30000); return () => { active = false; window.clearInterval(timer) } }, [token])
  return <>Messages {count > 0 && <span className="message-badge">{count > 99 ? '99+' : count}</span>}</>
}

function adviserFieldLabel(field) {
  return field.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase())
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60000)
}

function AdvisorDashboard() {
  const preview = useSiteEditor()?.preview
  const { accessToken: token, user: staffUser, ready } = useSessionBootstrap()
  const sample = { id: 'content-preview', status: 'in_review', email: 'Sample account', data: { firstName: 'Example', lastName: 'Student' }, requestedDocuments: ['passport'], documentSubmissions: {} }
  const [selected, setSelected] = useState(preview ? sample : null)
  const [page, setPage] = useState(1)
  const [pageMeta, setPageMeta] = useState({ total: 0, hasMore: false })
  const [securityOpen, setSecurityOpen] = useState(false)
  const [applications, setApplications] = useState(preview ? [sample] : [])
  const [selectedId, setSelectedId] = useState(null)
  const [filter, setFilter] = useState('all')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [documentRequestOpen, setDocumentRequestOpen] = useState(false)
  const [documentSelection, setDocumentSelection] = useState([])
  const [documentRequestVersion, setDocumentRequestVersion] = useState(null)
  const [messagesOpen, setMessagesOpen] = useState(false)
  const [pdfDownloading, setPdfDownloading] = useState(false)
  const listRequest = useRef(0)
  const can = (permission) => preview || staffUser?.role === 'advisor' || (staffUser?.role === 'moderator' && staffUser?.permissions?.advisorDashboard === true && staffUser?.permissions?.[permission] === true)
  const loadApplications = async (_currentToken = token, preserveError = false) => {
    if (preview) return
    const requestId = ++listRequest.current
    setLoading(true)
    try {
      const result = await api(`/api/advisor/applications?page=${page}&limit=25${filter === 'all' ? '' : '&status=' + encodeURIComponent(filter)}`)
      if (requestId !== listRequest.current || !getSession().accessToken) return
      setApplications(result.applications || []); setPageMeta(result)
      setSelectedId(current => result.applications?.some(item => item.id === current) ? current : result.applications?.[0]?.id || null)
      if (!preserveError) setError('')
    } catch (requestError) { if (requestId !== listRequest.current) return; setError(requestError.message); if ([401, 403].includes(requestError.status)) { setApplications([]); setSelected(null) } } finally { if (requestId === listRequest.current) setLoading(false) }
  }
  useEffect(() => {
    if (preview) return
    if (!token) { listRequest.current += 1; setApplications([]); setSelected(null); setSelectedId(null); setDocumentSelection([]); setDocumentRequestOpen(false); setSecurityOpen(false); setMessagesOpen(false); return undefined }
    loadApplications()
    const timer = window.setInterval(() => { if (!document.hidden) loadApplications(token, true) }, 30000)
    return () => { listRequest.current += 1; window.clearInterval(timer) }
  }, [token, page, filter, preview])
  useEffect(() => {
    if (preview) return
    let active = true
    setSelected(current => current?.id === selectedId ? current : null)
    if (selectedId) api(`/api/advisor/applications/${selectedId}`).then(result => { if (active) setSelected(result) }).catch(err => { if (active) setError(err.message) })
    return () => { active = false }
  }, [selectedId, applications, preview])
  useEffect(() => {
    if (preview) return
    setDocumentRequestOpen(false); setDocumentSelection([]); setDocumentRequestVersion(null) }, [selectedId])
  const updateApplicationStatus = async (id, status) => {
    setLoading(true); setError('')
    try {
      const response = await fetch(`/api/advisor/applications/${id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ status, version: selected?.version }) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Unable to update application')
      await loadApplications(token)
    } catch (requestError) { setError(requestError.message); setLoading(false) }
  }
  const openDocumentRequest = (application) => {
    setDocumentSelection(application.requestedDocuments || [])
    setDocumentRequestVersion(application.version)
    setDocumentRequestOpen(true)
    setError('')
  }
  const toggleDocumentSelection = (key) => setDocumentSelection((items) => items.includes(key) ? items.filter((item) => item !== key) : [...items, key])
  const sendDocumentRequest = async () => {
    if (!selected) return
    setLoading(true); setError('')
    try {
      const response = await fetch(`/api/advisor/applications/${selected.id}/documents`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ documents: documentSelection, version: documentRequestVersion }) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Unable to send document request')
      setDocumentRequestOpen(false)
      await loadApplications(token)
    } catch (requestError) { setError(requestError.message); setLoading(false) }
  }
  const reviewDocument = async (key, status) => {
    if (!selected) return
    setLoading(true); setError('')
    try {
      const response = await fetch(`/api/advisor/applications/${selected.id}/documents/${key}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ status, version: selected?.version }) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Unable to review document')
      await loadApplications(token)
    } catch (requestError) { setError(requestError.message); setLoading(false) }
  }
  const openDocumentFile = async (key, download = false) => {
    const preview = download ? null : window.open('', '_blank')
    if (preview) {
      preview.opener = null
      preview.document.title = 'Loading document…'
      preview.document.body.textContent = 'Loading document…'
    }
    setError('')
    try {
      const response = await fetch('/api/advisor/applications/' + selected.id + '/documents/' + key + '/file' + (download ? '?download=1' : ''), { headers: { Authorization: 'Bearer ' + token } })
      if (!response.ok) {
        const result = await response.json().catch(() => ({}))
        throw new Error(result.error || (download ? 'Unable to download document' : 'Unable to view document'))
      }
      const blob = await response.blob()
      if (!blob.size) throw new Error('The uploaded document is empty.')
      const disposition = response.headers.get('Content-Disposition') || ''
      const filename = selected.documentSubmissions?.[key]?.fileName || disposition.match(/filename="?([^";]+)"?/i)?.[1] || `${key}.${blob.type === 'application/pdf' ? 'pdf' : 'jpg'}`
      if (download) {
        downloadBlob(blob, filename)
      } else if (preview) {
        const url = URL.createObjectURL(blob)
        preview.location.replace(url)
        window.setTimeout(() => URL.revokeObjectURL(url), 60000)
      } else {
        throw new Error('Your browser blocked the document tab. Please allow pop-ups for this website and try again.')
      }
    } catch (requestError) {
      if (preview && !preview.closed) preview.close()
      setError(requestError.message)
    }
  }
  const downloadApplicationPdf = async () => {
    if (!selected || pdfDownloading) return
    setPdfDownloading(true); setError('')
    try {
      const response = await fetch(`/api/advisor/applications/${selected.id}/pdf`, { headers: { Authorization: `Bearer ${token}` } })
      if (!response.ok) {
        const result = await response.json().catch(() => ({}))
        throw new Error(result.error || 'Unable to create application PDF')
      }
      const blob = await response.blob()
      if (!blob.size) throw new Error('The application PDF was empty. Please try again.')
      const disposition = response.headers.get('Content-Disposition') || ''
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || 'student-application.pdf'
      downloadBlob(blob, filename)
    } catch (requestError) { setError(requestError.message) } finally { setPdfDownloading(false) }
  }
  const deleteApplication = async (id) => {
    if (!window.confirm('Delete this application? The student will no longer see it in their account.')) return
    setLoading(true); setError('')
    try {
      const response = await fetch(`/api/advisor/applications/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ version: selected?.version }) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Unable to delete application')
      await loadApplications(token)
    } catch (requestError) { setError(requestError.message); setLoading(false) }
  }
  const signOut = async () => { setLoading(true); setError(''); try { await logout(); setApplications([]); setSelected(null); setSelectedId(null); setMessagesOpen(false); setSecurityOpen(false) } catch (err) { setError(`Sign out could not finish: ${err.message} Please try again.`) } finally { setLoading(false) } }
  if (!ready) return <main className="auth-card" role="status">Loading your session…</main>
  if (!token && !preview) return <div className="portal-page adviser-login"><div className="portal-top"><Link className="logo" to="/"><span>student</span><strong>advisor</strong><b>®</b></Link><ThemeToggle /><Link to="/">Back to website</Link></div><SignInPanel workspace="advisor" onSuccess={() => setError('')} /></div>
  if (!preview && !can('advisorDashboard')) return <main className="auth-card"><h1>Access not granted</h1><p>This account cannot use the adviser workspace.</p><button onClick={signOut}>Sign out</button>{error && <p role="alert">{error}</p>}</main>
  if (securityOpen) return <div className="portal-page"><div className="portal-top"><button data-preview-navigation onClick={() => setSecurityOpen(false)}>Back to adviser workspace</button><ThemeToggle /><button onClick={signOut}>Sign out</button></div><main className="adviser-main">{error && <p role="alert" className="form-error">{error}</p>}<AccountSecurity preview={preview} onClose={() => setSecurityOpen(false)} /></main></div>
  if (messagesOpen && can('advisorMessages')) return <AdvisorMessagesPage token={token} onBack={() => setMessagesOpen(false)} onSignOut={signOut} signOutError={error} />
  const visibleApplications = applications
  const statusLabel = { submitted: 'Awaiting review', in_review: 'In processing', complete: 'Processed', draft: 'Draft', offer_received: 'Offer received' }
  const data = selected?.data || {}
  return <div className="portal-page adviser-page"><div className="portal-top"><a className="logo" href="/"><span>student</span><strong>advisor</strong><b>®</b></a><ThemeToggle /><div className="portal-nav"><span>{staffUser?.role === 'moderator' ? 'Moderator dashboard' : 'Adviser dashboard'}</span><button data-preview-navigation onClick={() => setSecurityOpen(true)}>Account security</button><button disabled={loading} onClick={signOut}>Sign out</button></div></div><main className="adviser-main">{error && <p className="form-error adviser-error" role="alert">{error}</p>}<div className="adviser-heading"><div><p className="eyebrow">{staffUser?.role === 'moderator' ? 'Moderator workspace' : 'Adviser workspace'}</p><h1>Student<br /><em>applications.</em></h1></div><div className="adviser-heading-actions">{can('advisorMessages') && <button className="button button-dark" onClick={() => setMessagesOpen(true)}>{preview ? 'Messages' : <AdvisorMessageBadge token={token} />}</button>}<button className="button button-dark" onClick={() => loadApplications()}>Refresh applications</button></div></div><div className="adviser-stats"><div><strong>{applications.length}</strong><span>Applications on this page</span></div><div><strong>{applications.filter((item) => item.status === 'submitted').length}</strong><span>Awaiting review on this page</span></div><div><strong>{applications.filter((item) => item.status === 'in_review').length}</strong><span>In processing on this page</span></div></div><div className="adviser-toolbar"><div><button className={filter === 'all' ? 'active' : ''} onClick={() => { setPage(1); setFilter('all') }}>All</button><button className={filter === 'submitted' ? 'active' : ''} onClick={() => { setPage(1); setFilter('submitted') }}>Awaiting review</button><button className={filter === 'in_review' ? 'active' : ''} onClick={() => { setPage(1); setFilter('in_review') }}>In processing</button><button className={filter === 'complete' ? 'active' : ''} onClick={() => { setPage(1); setFilter('complete') }}>Processed</button><button className={filter === 'draft' ? 'active' : ''} onClick={() => { setPage(1); setFilter('draft') }}>Drafts</button></div><span>{loading ? 'Updating…' : `${visibleApplications.length} shown`}</span></div><div className="adviser-grid"><section className="adviser-application-list">{visibleApplications.length ? visibleApplications.map((application) => <button className={selected?.id === application.id ? 'adviser-application active' : 'adviser-application'} key={application.id} onClick={() => setSelectedId(application.id)}><span className={`status-dot ${application.status}`}></span><span><strong>{application.data?.firstName || application.firstName || 'Unnamed student'} {application.data?.lastName || application.lastName || ''}</strong><small>{application.email} · {application.data?.university || 'University not selected'} · {statusLabel[application.status]}</small></span><b>{application.progress ?? applicationProgress(application.data)}%</b></button>) : <div className="adviser-empty">No applications match this filter.</div>}</section>{selected ? <section className="adviser-detail"><div className="adviser-detail-top"><div><p className="eyebrow">{statusLabel[selected.status]}</p><h2>{data.firstName || selected.firstName || 'Unnamed'} {data.lastName || selected.lastName || ''}</h2><p>{selected.email} · {data.university || 'University not selected'} · {data.course || 'Course not selected'}</p><div className="adviser-actions">{can('advisorStatusUpdates') && selected.status === 'submitted' && <button disabled={loading} className="button button-dark" onClick={() => updateApplicationStatus(selected.id, 'in_review')}>Accept & start processing</button>}{can('advisorStatusUpdates') && selected.status === 'in_review' && <button disabled={loading} className="button button-dark" onClick={() => updateApplicationStatus(selected.id, 'complete')}>Mark as processed</button>}{can('advisorStatusUpdates') && ['complete', 'offer_received'].includes(selected.status) && <button disabled={loading} className="button button-dark" onClick={() => updateApplicationStatus(selected.id, 'in_review' )}>Reopen for editing</button>}<button className="button button-dark pdf-download-button" disabled={pdfDownloading} onClick={downloadApplicationPdf}>{pdfDownloading ? 'Preparing PDF…' : 'Download application PDF'}</button>{can('advisorDeleteApplications') && <button disabled={loading} className="delete-application adviser-delete" onClick={() => deleteApplication(selected.id)}>Delete application</button>}{can('advisorDocuments') && selected.status === 'in_review' && <button className="ask-documents-link" onClick={() => openDocumentRequest(selected)}>Ask documents</button>}</div></div><div className="adviser-progress" style={{ '--progress': `${applicationProgress(data)}%` }}><strong>{applicationProgress(data)}%</strong><span>complete</span></div></div>{documentRequestOpen && can('advisorDocuments') && <div className="document-request-panel"><div className="document-request-heading"><div><p className="eyebrow">Request documents</p><h3>Select what the student must upload.</h3></div><button aria-label="Close document request" className="document-request-close" onClick={() => setDocumentRequestOpen(false)}>×</button></div><div className="document-request-list">{documentCatalog.map(([key, label]) => <label className="document-request-row" key={key}><input type="checkbox" checked={documentSelection.includes(key)} onChange={() => toggleDocumentSelection(key)} /><span>{label}</span></label>)}</div><button disabled={loading} className="button button-dark" onClick={sendDocumentRequest}>Send</button></div>}{selected.requestedDocuments?.length > 0 && <div className="document-review-panel"><div className="document-review-heading"><div><p className="eyebrow">Document review</p><h3>Review student uploads.</h3></div></div>{selected.requestedDocuments.map((key) => { const document = documentCatalog.find(([documentKey]) => documentKey === key); const submission = selected.documentSubmissions?.[key] || { status: 'pending' }; if (!document) return null; return <div className="document-review-row" key={key}><div><strong>{document[1]}</strong><span className={`document-review-status ${submission.status}`}>{documentReviewLabel(submission.status)}</span>{submission.fileName && <small>{submission.fileName}</small>}</div><div className="document-review-actions">{submission.hasFile && <><button onClick={() => openDocumentFile(key)}>View</button><button onClick={() => openDocumentFile(key, true)}>Download</button></>}{can('advisorDocuments') && submission.status === 'submitted' && <button disabled={loading} className="accept-document" onClick={() => reviewDocument(key, 'accepted')}>Accept</button>}{can('advisorDocuments') && ['submitted', 'accepted'].includes(submission.status) && <button disabled={loading} onClick={() => reviewDocument(key, 'rejected')}>Reject & ask resubmit</button>}</div></div>})}</div>}{applicationSections.filter((section) => section.id !== 'documents').map((section) => <div className="adviser-section" key={section.id}><div><h3><EditableText field={`section.${section.id}`} label="Section title">{section.title}</EditableText></h3><span>{Math.round((section.fields.filter(field => field !== 'englishScore').filter((field) => String(data[field] || '').trim()).length / section.fields.filter(field => field !== 'englishScore').length) * 100)}%</span></div><dl>{section.fields.map((field) => <div key={field}><dt><EditableText field={`field.${field}`} label="Field label">{adviserFieldLabel(field)}</EditableText></dt><dd>{data[field] || 'Not provided'}</dd></div>)}</dl></div>)}</section> : <section className="adviser-detail adviser-empty"><strong>Select an application</strong><p>Student details will appear here.</p></section>}</div><div className="pagination"><button disabled={loading || page === 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} · {pageMeta.total} applications</span><button disabled={loading || !pageMeta.hasMore} onClick={() => setPage(page + 1)}>Next</button></div></main></div>
}

class PortalErrorBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error) { console.error('Student account failed to render:', error) }
  render() {
    if (!this.state.error) return this.props.children
    return <div className="portal-page"><div className="portal-top"><a className="logo" href="#top" onClick={() => this.props.setMode('home')}><span>student</span><strong>advisor</strong><b>®</b></a><ThemeToggle /></div><main className="auth-card"><p className="eyebrow">Student account</p><h1>We need to<br /><em>reload this page.</em></h1><p className="auth-copy">The account page could not be displayed. Please reload the page. If the problem continues, sign out and sign in again.</p><button className="button button-dark full" onClick={() => window.location.reload()}>Reload account</button><button className="auth-secondary" onClick={this.props.onLogout}>Sign out and return home</button></main></div>
  }
}

function Portal(props) {
  return <PortalErrorBoundary setMode={props.setMode} onLogout={props.onLogout}>{props.mode === 'login' ? <div className="portal-page"><div className="portal-top"><a className="logo" href="/"><span>student</span><strong>advisor</strong><b>®</b></a><ThemeToggle /></div><SignInPanel onSuccess={() => props.setMode('dashboard')} onBack={() => props.setMode('home')} /></div> : props.mode === 'terms' ? <TermsPage onBack={() => props.setMode('dashboard')} /> : <DashboardPortal {...props} />}</PortalErrorBoundary>
}

function TermsPage({ onBack, backLabel = 'Back to application' }) {
  return <><Helmet><title>Terms and Conditions | Student Advisor</title><meta name="description" content="Read the Student Advisor terms and conditions for free UK university guidance, student accounts and application support." /><link rel="canonical" href="https://student-advisor.co.uk/terms" /></Helmet><div className="portal-page terms-page"><div className="portal-top"><a className="logo" href="/"><span>student</span><strong>advisor</strong><b>®</b></a><ThemeToggle /><button onClick={onBack}>{backLabel}</button></div><main className="terms-content"><p className="eyebrow">Student Advisor</p><h1>Terms &<br /><em>Conditions.</em></h1><p className="terms-updated">Effective date: 10 October 2026</p><p>These terms explain how Student Advisor helps prospective students explore UK study options, save application information, communicate with advisers and submit an application for review.</p><h2>1. About Student Advisor</h2><p>Student Advisor is an independent guidance service. We help students compare courses, prepare information and communicate with an adviser. We do not operate the universities shown on the website and cannot guarantee admission, funding, accommodation or a particular outcome.</p><h2>2. Using the website and account</h2><p>You must provide information that is accurate, current and not misleading. Keep your login details private and tell us promptly if you believe someone else has accessed your account. You must not upload harmful files, impersonate another person, misuse another student’s information or attempt to interfere with the website.</p><h2>3. Applications and adviser guidance</h2><p>Saving an application creates a draft. Submitting it sends the information to Student Advisor for review; it is not an application to a university unless we separately confirm that an application has been submitted to that university. Adviser comments concern course selection and university applications and should be checked against the relevant university’s current requirements.</p><p>You are responsible for checking deadlines, entry requirements, fees and the accuracy of documents before relying on them. We may ask for further documents and may lock a processed application. A locked application can only be changed if an adviser reopens it.</p><h2>4. Information you provide</h2><p>We use application details, uploaded documents and messages to provide the service, communicate with you, protect the website and manage adviser work. Do not upload information about another person unless you have permission and a lawful reason to do so. Our handling of personal data should also be read with any separate privacy notice we publish.</p><h2>5. Messages and communications</h2><p>Messages sent through “Let’s talk” or “Ask your advisor” may be read by authorised Student Advisor advisers. We aim to respond within a reasonable working period, but messages are not an emergency service and sending one does not create a guaranteed appointment or university submission.</p><h2>6. Fees and third-party services</h2><p>The current application guidance flow is provided without a charge unless we clearly tell you otherwise before you agree to a paid service. University fees, deposits, tests, translations and third-party charges are separate. University websites, Google Maps and other linked services have their own terms and privacy practices.</p><h2>7. Content and availability</h2><p>Website content is provided for guidance and may change as universities, courses, fees and deadlines change. We try to keep information useful, but do not promise that every listing is complete, uninterrupted or error-free. We may pause, update or withdraw features for maintenance, safety or operational reasons.</p><h2>8. Our responsibility</h2><p>Nothing in these terms limits liability that cannot lawfully be limited, including liability for death or personal injury caused by negligence, fraud, or your statutory consumer rights. Subject to that, Student Advisor is not responsible for decisions made by a university or other third party, or for losses caused by information you supplied being incomplete or inaccurate.</p><h2>9. Accessibility and fair treatment</h2><p>We aim to provide an inclusive service and will consider reasonable requests that help people use it. Please contact us through the adviser message form if you encounter an accessibility barrier or need information in another format.</p><h2>10. Changes and ending use</h2><p>We may update these terms when the service changes or legal requirements develop. The effective date above will change when we publish a new version. You may stop using your account at any time; provisions about information, intellectual property, liability and disputes continue where appropriate.</p><h2>11. Complaints and governing law</h2><p>Please first contact Student Advisor through your account or the website message form so we can investigate. These terms are governed by the law of England and Wales, unless mandatory consumer law where you live gives you a different right. Courts in England and Wales will normally have jurisdiction, subject to those mandatory rights.</p><h2>12. Legal context</h2><p>These terms are written with reference to UK guidance on fair consumer contracts, distance-service information, data protection and equality. Useful official sources include the <a href="https://www.gov.uk/guidance/writing-a-fair-contract-for-customers" target="_blank" rel="noreferrer">GOV.UK fair-contract guidance</a>, the <a href="https://www.legislation.gov.uk/uksi/2013/3134" target="_blank" rel="noreferrer">Consumer Contracts Regulations 2013</a>, and <a href="https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/" target="_blank" rel="noreferrer">ICO UK GDPR guidance</a>.</p><p className="terms-contact">Questions about these terms? Send a message to an adviser through your account.</p></main></div></>
}

function UniversityDetail({ university, onBack, onApply }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage?.startsWith('ro') ? 'ro' : 'en'
  const canonical = `${SITE_URL}${localizedPath(`/universities/${universitySlug(university.name)}`, locale)}`
  const description = t(`marketing.universityDescriptions.${universitySlug(university.name)}`, { defaultValue: university.description })
  useEffect(() => {
    const previousTitle = document.title
    document.title = `${university.name} | Student Advisor`
    return () => { document.title = previousTitle }
  }, [university.name])
  return <div className="university-detail-page"><Helmet><html lang={locale} /><title>{university.name} | Student Advisor</title><meta name="description" content={description} /><link rel="canonical" href={canonical} /><link rel="alternate" hrefLang="en" href={`${SITE_URL}${localizedPath(`/universities/${universitySlug(university.name)}`, 'en')}`} /><link rel="alternate" hrefLang="ro" href={`${SITE_URL}${localizedPath(`/universities/${universitySlug(university.name)}`, 'ro')}`} /><link rel="alternate" hrefLang="x-default" href={`${SITE_URL}${localizedPath(`/universities/${universitySlug(university.name)}`, 'en')}`} /><meta property="og:type" content="website" /><meta property="og:title" content={`${university.name} | Student Advisor`} /><meta property="og:description" content={description} /><meta property="og:url" content={canonical} /><meta property="og:image" content={SOCIAL_IMAGE} /><meta name="twitter:card" content="summary_large_image" /><script type="application/ld+json">{JSON.stringify({ '@context': 'https://schema.org', '@type': 'CollegeOrUniversity', name: university.name, url: canonical, description, mainEntityOfPage: canonical, subjectOf: { '@type': 'WebPage', dateModified: CONTENT_REVIEWED, publisher: { '@id': `${SITE_URL}/#organization`, name: SITE_NAME } } })}</script><script type="application/ld+json">{JSON.stringify(organization)}</script></Helmet>
    <header className="header detail-header"><button className="logo" onClick={onBack}><span>student</span><strong>advisor</strong><b>®</b></button><button className="detail-back" onClick={onBack}>{t('marketing.university.allInstitutions')}</button><button className="header-cta" onClick={() => onApply(university)}>{t('marketing.university.apply')}</button><LanguageSwitcher /><ThemeToggle /></header>
    <main>
      <section className="detail-hero">
        <div className="detail-hero-copy"><p className="eyebrow">{t('marketing.university.profile')}</p><h1><EditableText field="profile.name" label="University name">{university.name}</EditableText></h1><p><EditableText field="profile.description" label="University description">{t(`marketing.universityDescriptions.${universitySlug(university.name)}`, { defaultValue: university.description })}</EditableText></p><button className="button button-dark" onClick={() => onApply(university)}>{t('marketing.university.applyHelp')}</button></div>
        <div className="detail-logo-wrap"><EditableInlineImage field="profile.logo" label="University logo" fallback={university.logo} alt={t('marketing.university.placeholderLogo', { name: university.name })} /></div>
      </section>
      <section className="detail-content">
        <article className="detail-list-card"><p className="eyebrow">{t('marketing.university.profile')}</p><h2>{t('marketing.university.locations')}</h2><ul>{university.campuses.map((campus, index) => <li key={campus}><span aria-hidden="true">⌖</span><EditableText field={`campus.${index}`} label="Campus">{campus}</EditableText></li>)}</ul></article>
        <article className="detail-list-card"><p className="eyebrow">{t('marketing.explore.eyebrow')}</p><h2>{t('marketing.university.courses')}</h2><ul>{university.courses.map((course, index) => <li key={course}><span aria-hidden="true">→</span><EditableText field={`course.${index}`} label="Course">{course}</EditableText></li>)}</ul></article>
      </section>
    </main>
    <footer><button className="logo" onClick={onBack}><span>student</span><strong>advisor</strong><b>®</b></button><p>{t('marketing.footer.tagline')}</p><button onClick={onBack}>{t('marketing.university.browse')}</button><span>© 2026 Student Advisor</span></footer>
  </div>
}

function MarketingHome({ query, setQuery, saved, toggleSaved, openUniversity, formOpen, setFormOpen, submitted, setSubmitted, contactError, contactSending, submitContact, menuOpen, setMenuOpen, scrollTo, filtered, openApplication }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage?.startsWith('ro') ? 'ro' : 'en'
  const steps = t('marketing.pathway.steps', { returnObjects: true })
  const topics = t('marketing.contact.topics', { returnObjects: true })
  return <><div className="site-shell">
    <div className="notice"><EditableText field="notice" label="Application notice">{t('marketing.notice', { stage: currentApplicationStage(new Date(), i18n.resolvedLanguage) })}</EditableText> <button onClick={() => setFormOpen(true)}>{t('marketing.startConversation')}</button></div>
    <header className="header"><a className="logo" href="#top"><span>student</span><strong>advisor</strong><b>®</b></a><ThemeToggle /><button className="menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label={t('marketing.nav.menu')}>☰</button><nav className={menuOpen ? 'nav open' : 'nav'}><button onClick={() => scrollTo('explore')}>{t('marketing.nav.explore')}</button><button onClick={() => scrollTo('universities')}>{t('marketing.nav.universities')}</button><button onClick={() => scrollTo('pathway')}>{t('marketing.nav.howItWorks')}</button><button onClick={() => scrollTo('stories')}>{t('marketing.nav.advice')}</button><Link to={localizedPath('/blog', locale)}>{t('navigation.blog')}</Link></nav><div className="header-actions"><LanguageSwitcher /><button className="saved-link" onClick={() => scrollTo('universities')}>{t('marketing.nav.saved')} <span>{saved.length}</span></button><button className="account-link" onClick={() => openApplication()}>{t('marketing.nav.studentAccount')}</button><button className="header-cta" onClick={() => setFormOpen(true)}>{t('marketing.nav.talkToAdvisor')}</button></div></header>
    <main id="top">
      <section className="hero"><div className="hero-copy"><p className="eyebrow"><EditableText field="hero.eyebrow" label="Hero eyebrow">{t('marketing.hero.eyebrow')}</EditableText></p><h1><EditableText field="hero.title" label="Hero heading">{t('marketing.hero.title')}</EditableText></h1><p className="hero-intro"><EditableText field="hero.intro" label="Hero introduction">{t('marketing.hero.intro')}</EditableText></p><div className="hero-actions"><button className="button button-dark" onClick={() => scrollTo('explore')}>{t('marketing.hero.findOptions')}</button><button className="watch-link" onClick={() => setFormOpen(true)}><u>{t('marketing.hero.ask')}</u></button></div></div><nav className="hero-guide-links" aria-label={t('navigation.aria')}><Link to={localizedPath('/free-student-advisory', locale)}>{t('navigation.freeAdvisory')}</Link><Link to={localizedPath('/university-admission', locale)}>{t('navigation.admission')}</Link><Link to={localizedPath('/study-in-uk', locale)}>{t('navigation.studyUk')}</Link></nav><div className="hero-visual"><EditableImage field="hero.primaryImage" label="Large hero image" className="hero-image image-one" fallback={homeImages.heroPrimary} overlay="linear-gradient(180deg,transparent 45%,#10131b45)" /><EditableImage field="hero.secondaryImage" label="Small hero image" className="hero-image image-two" fallback={homeImages.heroSecondary} overlay="linear-gradient(180deg,transparent 45%,#10131b33)" /><div className="hero-sticker">EXPLORE<br /><b>UK</b><br />UNIVERSITIES <span>✦</span></div></div></section>
      <section className="intro-band"><p className="eyebrow"><EditableText field="intro.eyebrow" label="Introduction eyebrow">{t('marketing.intro.eyebrow')}</EditableText></p><div className="intro-grid"><h2><EditableText field="intro.title" label="Introduction heading">{t('marketing.intro.title')}</EditableText></h2><p><EditableText field="intro.copy" label="Introduction text">{t('marketing.intro.copy')}</EditableText></p></div></section>
      <section className="explore-section" id="explore"><div className="section-top"><div><p className="eyebrow"><EditableText field="explore.eyebrow" label="Explore eyebrow">{t('marketing.explore.eyebrow')}</EditableText></p><h2><EditableText field="explore.title" label="Explore heading">{t('marketing.explore.title')}</EditableText></h2></div><p className="section-caption"><EditableText field="explore.caption" label="Explore caption">{t('marketing.explore.caption')}</EditableText></p></div><div className="explore-tools"><div className="search-box"><span>⌕</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('marketing.explore.placeholder')} aria-label={t('marketing.explore.placeholder')} /></div><div className="quick-links"><button onClick={() => setQuery('Business')}>{t('marketing.explore.business')}</button><button onClick={() => setQuery('Computer Science')}>{t('marketing.explore.computerScience')}</button><button onClick={() => setQuery('Design')}>{t('marketing.explore.design')}</button><button onClick={() => setQuery('')}>{t('marketing.explore.allCourses')}</button></div></div></section>
      <section className="pathway" id="pathway"><div className="section-top"><div><p className="eyebrow"><EditableText field="pathway.eyebrow" label="Process eyebrow">{t('marketing.pathway.eyebrow')}</EditableText></p><h2><EditableText field="pathway.title" label="Process heading">{t('marketing.pathway.title')}</EditableText></h2></div><p className="section-caption"><EditableText field="pathway.caption" label="Process caption">{t('marketing.pathway.caption')}</EditableText></p></div><div className="free-advice-note"><strong><EditableText field="pathway.promise" label="Advice promise">{t('marketing.pathway.promise')}</EditableText></strong><span><EditableText field="pathway.promiseCopy" label="Advice promise text">{t('marketing.pathway.promiseCopy')}</EditableText></span></div><div className="pathway-grid">{steps.map((step, index) => <article className="pathway-card" key={step.title}><span>0{index + 1}</span><div><h3><EditableText field={`pathway.step${index + 1}.title`} label={`Step ${index + 1} heading`}>{step.title}</EditableText></h3><p><EditableText field={`pathway.step${index + 1}.copy`} label={`Step ${index + 1} text`}>{step.copy}</EditableText></p><button onClick={() => setFormOpen(true)}>{t('marketing.pathway.talk')}</button></div></article>)}</div></section>
      <section className="universities" id="universities"><div className="section-top"><div><p className="eyebrow"><EditableText field="directory.eyebrow" label="University directory eyebrow">{t('marketing.directory.eyebrow')}</EditableText></p><h2><EditableText field="directory.title" label="University directory heading">{t('marketing.directory.title')}</EditableText></h2></div><span className="all-link">{t('marketing.directory.count', { filtered: filtered.length, total: universities.length })}</span></div><div className="filters"><strong>{query ? t('marketing.directory.results', { query }) : t('marketing.directory.all')}</strong><span><EditableText field="directory.caption" label="University directory caption">{t('marketing.directory.caption')}</EditableText></span></div><div className="uni-grid">{filtered.map((university) => { const slug = universitySlug(university.name); return <article className="uni-card institution-card" key={university.name}><div className="uni-image institution-logo"><EditableInlineImage field={`directory.${slug}.logo`} label={`${university.name} image`} fallback={university.logo} alt={t('marketing.university.placeholderLogo', { name: university.name })} /><button className={saved.includes(university.name) ? 'heart saved' : 'heart'} onClick={() => toggleSaved(university.name)} aria-label={t('marketing.directory.save', { name: university.name })}>{saved.includes(university.name) ? '♥' : '♡'}</button></div><div className="uni-details"><p className="uni-city"><EditableText field={`directory.${slug}.campuses`} label={`${university.name} campus summary`}>{university.campuses.slice(0, 2).join(' · ') + (university.campuses.length > 2 ? ` · +${university.campuses.length - 2}` : '')}</EditableText></p><h3><EditableText field={`directory.${slug}.name`} label={`${university.name} display name`}>{university.name}</EditableText></h3><p className="uni-description"><EditableText field={`directory.${slug}.description`} label={`${university.name} description`}>{t(`marketing.universityDescriptions.${slug}`, { defaultValue: university.description })}</EditableText></p><div className="uni-footer"><button onClick={() => openUniversity(university)}>{t('marketing.directory.moreInfo')}</button></div></div></article> })}</div>{filtered.length === 0 && <div className="empty-state">{t('marketing.directory.noResults')} <button onClick={() => setQuery('')}>{t('marketing.directory.clear')}</button></div>}</section>
      <section className="story" id="stories"><EditableImage field="story.image" label="Student story image" className="story-image" fallback={homeImages.story} overlay="linear-gradient(180deg,#10131b00,#10131b66)" /><div className="story-copy"><p className="eyebrow"><EditableText field="story.eyebrow" label="Story eyebrow">{t('marketing.story.eyebrow')}</EditableText></p><h2><EditableText field="story.title" label="Story heading">{t('marketing.story.title')}</EditableText></h2><p><EditableText field="story.copy" label="Story text">{t('marketing.story.copy')}</EditableText></p><button className="button button-light" onClick={() => setFormOpen(true)}>{t('marketing.story.cta')}</button></div><div className="story-quote">“</div></section>
      <HomeFaq />
    </main>
    <footer><a className="logo" href="#top"><span>student</span><strong>advisor</strong><b>®</b></a><p><EditableText field="footer.tagline" label="Footer tagline">{t('marketing.footer.tagline')}</EditableText></p><Link className="footer-terms" to="/privacy">Privacy notice</Link><a className="footer-terms" href="/terms">{t('marketing.footer.terms')}</a><button onClick={() => setFormOpen(true)}>{t('marketing.footer.contact')}</button><span>© 2026 Student Advisor</span></footer>
    {formOpen && <AccessibleDialog title={t('marketing.contact.title')} onClose={() => setFormOpen(false)}>{submitted ? <div className="success"><div className="success-icon">✓</div><p className="eyebrow">{t('marketing.contact.received')}</p><h2>{t('marketing.contact.thanks')}</h2><p>{t('marketing.contact.reply')}</p><button className="button button-dark" onClick={() => { setFormOpen(false); setSubmitted(false) }}>{t('marketing.contact.back')}</button></div> : <><button className="close" aria-label="Close contact form" onClick={() => setFormOpen(false)}>×</button><p className="eyebrow">{t('marketing.contact.eyebrow')}</p><h2>{t('marketing.contact.title')}</h2><p className="modal-intro">{t('marketing.contact.intro')}</p><form onSubmit={submitContact}><label>{t('marketing.contact.name')}<input name="name" required placeholder={t('marketing.contact.namePlaceholder')} /></label><label>{t('marketing.contact.email')}<input name="email" required type="email" placeholder="alex@student.com" /></label><label>{t('marketing.contact.topic')}<select name="topic" required defaultValue=""><option value="" disabled>{t('marketing.contact.select')}</option>{topics.map((topic) => <option key={topic}>{topic}</option>)}</select></label><label>{t('marketing.contact.message')}<textarea name="message" required placeholder={t('marketing.contact.messagePlaceholder')} /></label>{contactError && <p className="form-error" role="alert">{contactError}</p>}<button className="button button-dark full" disabled={contactSending} type="submit">{t('marketing.contact.send')}</button><p className="privacy-link"><Link to="/privacy">Privacy notice</Link></p></form></>}</AccessibleDialog>}
  </div></>
}

function requestedView() {
  const params = new URLSearchParams(window.location.search)
  return params.has('auth') ? 'login' : params.get('apply') === '1' ? 'dashboard' : 'home'
}

function App() {
  const editor = useSiteEditor()
  const { i18n } = useTranslation()
  const locale = i18n.resolvedLanguage?.startsWith('ro') ? 'ro' : 'en'
  const location = useLocation()
  const navigate = useNavigate()
  const session = useSessionBootstrap()
  const [query, setQuery] = useState(''), [saved, setSaved] = useState([])
  const [formOpen, setFormOpen] = useState(false), [submitted, setSubmitted] = useState(false), [contactError, setContactError] = useState(''), [contactSending, setContactSending] = useState(false), [menuOpen, setMenuOpen] = useState(false)
  const [view, setViewState] = useState(requestedView)
  const [selectedUniversity, setSelectedUniversity] = useState(null)
  const [detailUniversity, setDetailUniversity] = useState(() => universityFromPath(window.location.pathname))
  const [sessionError, setSessionError] = useState('')
  const [signingOut, setSigningOut] = useState(false)
  const setView = nextView => {
    // Refresh should restore the page the student chose, independently of login.
    const url = new URL(window.location.href)
    if (nextView === 'home') {
      url.searchParams.delete('apply')
      url.searchParams.delete('auth')
    } else if (nextView === 'dashboard' || nextView === 'login') {
      url.searchParams.set('apply', '1'); if (nextView === 'dashboard') url.searchParams.delete('auth')
    }
    navigate(url.pathname + url.search + url.hash, { replace: true })
    setViewState(nextView)
  }
  const initialSession = useRef(false)
  useEffect(() => {
    if (!session.ready || initialSession.current) return
    initialSession.current = true
    const editRequested = new URLSearchParams(window.location.search).get('edit') === '1'
    const mayEdit = session.user?.role === 'admin' || (session.user?.role === 'moderator' && session.user?.permissions?.manageContent)
    if (session.user && session.user.role !== 'student' && !detailUniversity && view !== 'login' && !((editRequested || editor?.enabled) && mayEdit)) {
      window.location.assign(session.user.role === 'advisor' ? '/advisor' : '/admin')
    }
  }, [session.ready, session.user])
  useEffect(() => { setDetailUniversity(universityFromPath(location.pathname)); setViewState(requestedView()) }, [location.pathname, location.search])
  const filtered = useMemo(() => { const search = query.trim().toLowerCase(); return search ? universities.filter(university => [university.name, ...university.campuses, ...university.courses].some(value => value.toLowerCase().includes(search))) : universities }, [query])
  const scrollTo = id => { setMenuOpen(false); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }) }
  const submitContact = async event => {
    event.preventDefault(); if (contactSending) return; setContactSending(true); setContactError('')
    const payload = Object.fromEntries(new FormData(event.currentTarget))
    try { await api('/api/support-messages', { method: 'POST', auth: false, body: payload }); setSubmitted(true) } catch (error) { setContactError(error.message) } finally { setContactSending(false) }
  }
  const toggleSaved = name => setSaved(items => items.includes(name) ? items.filter(item => item !== name) : [...items, name])
  const openUniversity = university => { navigate(`${localizedPath(`/universities/${universitySlug(university.name)}`, locale)}${editor?.enabled ? '?edit=1' : ''}`); setDetailUniversity(university); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const closeUniversity = () => { navigate(`${localizedPath('/', locale)}${editor?.enabled ? '?edit=1' : ''}`); setDetailUniversity(null); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const openApplication = async (university = null) => {
    setSelectedUniversity(university); setSessionError(''); if (editor?.enabled) { navigate('/?apply=1&edit=1'); return }
    if (detailUniversity) { navigate(editor?.enabled ? '/?edit=1' : '/', { replace: true }); setDetailUniversity(null) }
    window.scrollTo({ top: 0, behavior: 'smooth' })
    try {
      if (!getSession().ready) await refreshSession()
      const current = getSession()
      if (current.user && current.user.role !== 'student') return window.location.assign(current.user.role === 'advisor' ? '/advisor' : '/admin')
      setView(current.accessToken ? 'dashboard' : 'login')
    } catch (error) { setSessionError(error.message); setView('login') }
  }
  const signOut = async () => {
    if (signingOut) return
    setSigningOut(true); setSessionError('')
    try { await logout(); setView('home'); setSelectedUniversity(null) } catch (error) { setSessionError(`Sign out could not finish: ${error.message} Please try again.`) } finally { setSigningOut(false) }
  }
  if (editor?.preview && view !== 'home') return <DashboardPortal preview setMode={setView} selectedUniversity={selectedUniversity} onLogout={() => {}} />
  if (view !== 'home') return <>{sessionError && <p role="alert" className="request-status">{sessionError}</p>}{signingOut && <p role="status" className="request-status">Signing out…</p>}<Portal mode={view === 'dashboard' && !session.accessToken ? 'login' : view} setMode={setView} selectedUniversity={selectedUniversity} onLogout={signOut} /></>
  if (detailUniversity) return <UniversityDetail university={detailUniversity} onBack={closeUniversity} onApply={openApplication} />
  return <MarketingHome query={query} setQuery={setQuery} saved={saved} toggleSaved={toggleSaved} openUniversity={openUniversity} formOpen={formOpen} setFormOpen={setFormOpen} submitted={submitted} setSubmitted={setSubmitted} contactError={contactError} contactSending={contactSending} submitContact={submitContact} menuOpen={menuOpen} setMenuOpen={setMenuOpen} scrollTo={scrollTo} filtered={filtered} openApplication={openApplication} />
}
function ScrollToRoutePosition() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (!hash) {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
      return
    }
    let targetId; try { targetId = decodeURIComponent(hash.slice(1)) } catch { return }
    requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({ block: 'start', behavior: 'auto' })
    })
  }, [pathname, hash])
  return null
}

function Root() {
  return <Suspense fallback={<main className="auth-card" role="status">Loading page…</main>}><Routes><Route path="/privacy" element={<PrivacyPage />} /><Route path="/verify-email/:token" element={<VerifyEmailPage />} /><Route path="/terms" element={<TermsPage backLabel="Back to website" onBack={() => { window.location.href = '/' }} />} /><Route path="/advisor/*" element={<AdvisorDashboard />} /><Route path="/admin/*" element={<AdminDashboard />} /><Route path="/forgot-password" element={<ForgotPasswordPage />} /><Route path="/reset-password/:token" element={<ResetPasswordPage />} />{['en', 'ro', ''].map(prefix => <Route key={`editorial-${prefix || 'legacy'}`} path={`${prefix ? `/${prefix}` : ''}/free-student-advisory`} element={<EditorialPage pageKey="free-student-advisory" />} />)}{['en', 'ro', ''].map(prefix => <Route key={`study-${prefix || 'legacy'}`} path={`${prefix ? `/${prefix}` : ''}/study-in-uk`} element={<EditorialPage pageKey="study-in-uk" />} />)}{['en', 'ro', ''].map(prefix => <Route key={`admission-${prefix || 'legacy'}`} path={`${prefix ? `/${prefix}` : ''}/university-admission`} element={<EditorialPage pageKey="university-admission" />} />)}{['student-visa-costs', 'editorial-policy'].flatMap(pageKey => ['en', 'ro', ''].map(prefix => <Route key={`${pageKey}-${prefix || 'legacy'}`} path={`${prefix ? `/${prefix}` : ''}/${pageKey}`} element={<EditorialPage pageKey={pageKey} />} />))}{['en', 'ro', ''].map(prefix => <Route key={`blog-${prefix || 'legacy'}`} path={`${prefix ? `/${prefix}` : ''}/blog`} element={<BlogIndex />} />)}{['en', 'ro', ''].map(prefix => <Route key={`article-${prefix || 'legacy'}`} path={`${prefix ? `/${prefix}` : ''}/blog/:slug`} element={<BlogArticle />} />)}<Route path="*" element={<App />} /></Routes></Suspense>
}

loadTranslations().then(() => createRoot(document.getElementById('root')).render(<StrictMode><HelmetProvider><ThemeProvider><BrowserRouter><SiteEditorProvider><ScrollToRoutePosition /><Root /></SiteEditorProvider></BrowserRouter></ThemeProvider></HelmetProvider></StrictMode>)).catch((error) => {
  console.error(error)
  createRoot(document.getElementById('root')).render(<div className="fatal-error">Unable to load the website. Please refresh and try again.</div>)
})
