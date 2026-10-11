export const SITE_URL = 'https://student-advisor.co.uk'
export const SITE_NAME = 'Student Advisor'
export const SOCIAL_IMAGE = `${SITE_URL}/student-advisor-social-card.svg`
export const CONTENT_REVIEWED = '2026-10-11'
export const CONTENT_REVIEWED_LABEL = { en: 'Reviewed 11 October 2026', ro: 'Revizuit la 11 octombrie 2026' }

export const organization = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': `${SITE_URL}/#organization`,
  name: SITE_NAME,
  url: SITE_URL,
  logo: `${SITE_URL}/university-logo-mark.png`,
  description: 'Free, practical guidance for prospective students exploring UK university study and applications.',
  areaServed: { '@type': 'Country', name: 'United Kingdom' },
  knowsAbout: ['UK university applications', 'university admissions', 'student finance guidance', 'international student guidance'],
  contactPoint: {
    '@type': 'ContactPoint',
    contactType: 'student advisory',
    availableLanguage: ['English', 'Romanian'],
    url: `${SITE_URL}/en/free-student-advisory`,
  },
}

export const blogArticles = [
  ['inscriere-gratuita-universitate-uk', 'inscriere gratuita universitate uk', 'Înscriere gratuită la universitate în UK: ghid pentru români', 'Free university application support in the UK: a Romanian guide', 'procesul de aplicare fără taxă de consultanță', 'application planning without an adviser charge'],
  ['student-finance-romani-uk', 'student finance romani uk', 'Student Finance pentru români în UK: eligibilitate și pași', 'Student Finance for Romanians in the UK: eligibility and steps', 'eligibilitate, documente și aplicația Student Finance England', 'eligibility, evidence and a Student Finance England application'],
  ['facultate-2-zile-pe-saptamana-uk', 'facultate 2 zile pe saptamana uk', 'Facultate 2 zile pe săptămână în UK: cum verifici programul', 'University two days a week in the UK: how to check a timetable', 'orarul de campus, studiul independent și alegerea cursului', 'campus timetables, independent study and course selection'],
  ['faci-scoala-si-primesti-bani-anglia', 'faci scoala si primesti bani anglia', 'Faci școală și primești bani în Anglia: ce înseamnă în realitate', 'Study and receive money in England: what it really means', 'împrumuturile pentru studii, costurile de trai și bugetul personal', 'student loans, living costs and personal budgeting'],
  ['imprumut-pentru-facultate-anglia', 'imprumut pentru facultate anglia', 'Împrumut pentru facultate în Anglia: taxe, întreținere și rambursare', 'University loan in England: fees, maintenance and repayment', 'împrumutul pentru taxa de școlarizare și împrumutul de întreținere', 'tuition-fee loans and maintenance loans'],
  ['student-finance-england-romana', 'student finance england romana', 'Student Finance England în română: ghid clar de aplicare', 'Student Finance England explained in Romanian: a clear guide', 'contul Student Finance, dovezile și termenele de aplicare', 'Student Finance accounts, evidence and application deadlines'],
  ['studii-finantate-in-uk', 'studii finantate in uk', 'Studii finanțate în UK: ce trebuie verificat înainte să aplici', 'Funded study in the UK: what to check before applying', 'cursuri eligibile, statut de rezidență și finanțare responsabilă', 'eligible courses, residency status and responsible funding'],
  ['cursuri-weekend-universitate-anglia', 'cursuri de weekend universitate anglia', 'Cursuri de weekend la universitate în Anglia: ghid de alegere', 'Weekend university courses in England: a selection guide', 'programe flexibile, prezență și cerințe academice', 'flexible study, attendance and academic requirements'],
  ['maintenance-loan-romani', 'maintenance loan romani', 'Maintenance Loan pentru români: cheltuieli de trai în UK', 'Maintenance Loan for Romanians: living costs in the UK', 'sprijinul pentru costurile de trai și modul de calcul', 'living-cost support and how it is assessed'],
  ['bursa-de-intretinere-uk', 'bursa de intretinere uk', 'Bursă de întreținere în UK: grant, bursă sau Maintenance Loan?', 'UK maintenance support: grant, bursary or Maintenance Loan?', 'diferența dintre împrumut, bursă și sprijin suplimentar', 'the difference between loans, bursaries and additional support'],
  ['facultate-seral-londra-romani', 'facultate seral londra romani', 'Facultate seral în Londra pentru români: opțiuni și verificări', 'Evening university in London for Romanians: options and checks', 'orarul de seară, naveta, prezența și finanțarea', 'evening timetables, travel, attendance and funding'],
  ['admitere-facultate-uk-fara-engleza', 'admitere facultate uk fara engleza', 'Admitere la facultate în UK fără engleză: ce este posibil', 'University admission in the UK without English: what is possible', 'cerințele de limbă engleză, cursurile pregătitoare și admiterea', 'English-language requirements, preparation and admission'],
].map(([slug, keyword, titleRo, titleEn, focusRo, focusEn]) => ({ slug, keyword, titleRo, titleEn, focusRo, focusEn }))

export const officialSources = [
  ['Student Finance England', 'https://www.gov.uk/student-finance'],
  ['UCAS application guidance', 'https://www.ucas.com/applying/applying-university'],
  ['UK Student visa fees', 'https://www.gov.uk/government/publications/visa-regulations-revised-table/home-office-immigration-and-nationality-fees-8-april-2026'],
  ['Immigration Health Surcharge', 'https://www.gov.uk/healthcare-immigration-application/how-much-pay'],
]
