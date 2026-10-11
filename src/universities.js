import { stripLocale } from './locale-routes.js'

export const universities = [
  {
    name: 'ARU London',
    logo: 'https://placehold.co/720x420/F25336/FFFFFF?text=ARU+London',
    campuses: ['East India, London (Import and Export Buildings)'],
    courses: ['BSc (Hons) International Business Management', 'BSc (Hons) Finance and Accounting', 'BSc (Hons) Health and Social Care', 'LLB (Hons) Law', 'MBA International'],
    description: 'ARU London delivers Anglia Ruskin University-validated degrees from its career-focused campus in East London. Its programmes emphasise employability, practical learning and support from industry-experienced lecturers.',
  },
  {
    name: 'Arden University',
    logo: 'https://placehold.co/720x420/202B5B/FFFFFF?text=Arden+University',
    campuses: ['Stratford, London', 'Ealing, London', 'Holborn, London', 'Birmingham Crossways', 'Manchester', 'Leeds City Centre', 'Nottingham', 'Newcastle', 'Berlin City Centre, Germany'],
    courses: ['Business Management', 'Computing', 'Criminology and Law', 'Psychology', 'Healthcare Management', 'Master of Business Administration'],
    description: 'Arden University specialises in flexible higher education through blended campus study and fully online learning. It offers career-oriented undergraduate and postgraduate programmes across business, technology, law, psychology and healthcare.',
  },
  {
    name: 'LCCA - London College of Contemporary Arts',
    logo: 'https://placehold.co/720x420/171717/FFFFFF?text=LCCA',
    campuses: ['Tower Hill, London'],
    courses: ['BA (Hons) Fashion', 'BA (Hons) Graphic Design', 'BA (Hons) Fashion Management and Marketing', 'BA (Hons) Computer Games Art', 'BA (Hons) Hospitality Management and Leadership', 'BA (Hons) Business Management and Entrepreneurship'],
    description: 'LCCA is a specialist creative college in central London offering practical programmes linked closely to industry. Its portfolio brings together fashion, graphic design, games, hospitality and creative business.',
  },
  {
    name: 'LSC - London School of Commerce',
    logo: 'https://placehold.co/720x420/7D1B33/FFFFFF?text=LSC',
    campuses: ['Chaucer House, London Bridge', 'Pocock House, Southwark, London', 'McLaren Building, Birmingham', 'City Tower, Manchester'],
    courses: ['BA (Hons) Business Studies with Foundation Year', 'Business and Management', 'Health and Social Care', 'Master of Business Administration', 'International Business Management'],
    description: 'The London School of Commerce works with British universities to deliver undergraduate and postgraduate qualifications. Its teaching centres focus particularly on accessible programmes in business, management and health and social care.',
  },
  {
    name: 'CECOS College',
    logo: 'https://placehold.co/720x420/0D6B5B/FFFFFF?text=CECOS+College',
    campuses: ['Edmonton Green, London', 'Stepney Green, London', 'Digbeth, Birmingham', 'Currer Street, Bradford', 'The Hat Loft, Luton', 'Newcastle'],
    courses: ['Business and Management', 'Health and Social Care', 'Information Technology', 'Teacher Training', 'Functional Skills and ESOL'],
    description: 'CECOS College provides flexible further and higher education from learning centres across England. Its vocational programmes combine academic study with practical, employment-focused skills and learner support.',
  },
  {
    name: 'GBS - Global Banking School',
    logo: 'https://placehold.co/720x420/132D46/FFFFFF?text=GBS',
    campuses: ['Greenford, London', 'Republic – Canary Wharf, London', 'GEDU House – Stratford, London', 'Cam Road – Stratford, London', 'Bow Road, London', 'Norfolk House, Birmingham', 'Brindleyplace, Birmingham', 'Universal Square, Manchester', 'St George House, Leeds', 'Wellington Place, Leeds'],
    courses: ['BA (Hons) Global Business and Entrepreneurship', 'BSc (Hons) Accounting and Financial Management', 'BSc (Hons) Computing', 'BSc (Hons) Construction Management', 'BSc (Hons) Health, Wellbeing and Social Care', 'BSc (Hons) Psychology with Counselling'],
    description: 'GBS delivers flexible, industry-focused higher education in partnership with recognised universities. Its programmes support a diverse student community across business, finance, computing, construction, psychology and health and social care.',
  },
  {
    name: 'William College',
    logo: 'https://placehold.co/720x420/2D388A/FFFFFF?text=William+College',
    campuses: ['Stratford, London', 'Leeds'],
    courses: ['BA (Hons) Business and Management (Law) with Integrated Foundation Year', 'BSc Business Management (Human Resource Management) with Foundation Year', 'CertHE Business and Management'],
    description: 'William College offers inclusive, career-focused higher education at its Stratford and Leeds campuses. Its business and law programmes develop practical knowledge alongside communication, analytical and problem-solving skills.',
  },
  {
    name: 'Canterbury Christ Church University',
    logo: 'https://placehold.co/720x420/5A246D/FFFFFF?text=CCCU',
    campuses: ['Canterbury Campus', 'Medway Campus, Chatham', 'Salomons Institute, Tunbridge Wells'],
    courses: ['Business Management', 'Computer Science', 'Nursing', 'Primary Education with QTS', 'Law', 'Tourism and Events Management'],
    description: 'Canterbury Christ Church University is a public university with a strong presence across Kent. It is known for professionally relevant education in teaching, health, business, creative subjects, sciences and the professions.',
  },
  {
    name: 'Bath Spa University',
    logo: 'https://placehold.co/720x420/4B176A/FFFFFF?text=Bath+Spa+University',
    campuses: ['Newton Park, Bath', 'Locksbrook Campus, Bath', 'Oldfield Park Theatre Workshops, Bath', 'Corsham Court, Wiltshire'],
    courses: ['Business and Management', 'Creative Writing', 'Psychology', 'Architecture', 'Fine Art', 'Commercial Music'],
    description: 'Bath Spa University combines a long creative heritage with contemporary teaching and specialist facilities. Its courses span arts, design, business, education, humanities, music and sciences across distinctive campuses in and around Bath.',
  },
  {
    name: 'Oxford Brookes University',
    logo: 'https://placehold.co/720x420/17365D/FFFFFF?text=Oxford+Brookes',
    campuses: ['Headington Campus, Oxford', 'Harcourt Hill Campus, Oxford', 'Swindon Campus'],
    courses: ['Architecture', 'Business and Management', 'Computer Science', 'Motorsport Engineering', 'Nursing', 'Psychology'],
    description: 'Oxford Brookes University is a modern university recognised for applied learning, industry links and research-informed teaching. It offers a broad course portfolio with particular strengths in architecture, business, health, technology and motorsport.',
  },
  {
    name: 'University of Suffolk',
    logo: 'https://placehold.co/720x420/006B7D/FFFFFF?text=University+of+Suffolk',
    campuses: ['Ipswich Waterfront Campus', 'London Centre, East London'],
    courses: ['Business Management', 'Computer Games', 'Esports', 'Biomedical Science', 'Nursing', 'Psychology'],
    description: 'The University of Suffolk is a modern, community-focused university based on the Ipswich Waterfront with an additional London centre. Its teaching is shaped by regional and industry partnerships across business, technology, health, science and the creative industries.',
  },
  {
    name: 'Pearson College London',
    logo: 'https://placehold.co/720x420/552583/FFFFFF?text=Pearson+College+London',
    campuses: ['North Greenwich, London'],
    courses: ['The Art of Visual Effects', 'Animation', 'Video Games Art and Design', 'Game Design', 'Concept Art', 'Motion Graphics'],
    description: 'Pearson College London brought together Pearson Business School and the creative training specialist Escape Studios. Its continuing specialist provision is associated with Escape Studios in North Greenwich, where students study animation, games and visual effects in an industry-style environment.',
  },
]

export function universitySlug(name) {
  return name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

export function universityFromPath(pathname) {
  const match = stripLocale(pathname).match(/^\/universities\/([^/]+)\/?$/)
  return match ? universities.find((university) => universitySlug(university.name) === match[1]) || null : null
}
