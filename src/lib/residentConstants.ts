export const ETHNICITY_OPTIONS = [
  { value: "Harari", am: "ሐረሪ", en: "Harari" },
  { value: "Oromo", am: "ኦሮሞ", en: "Oromo" },
  { value: "Amhara", am: "አማራ", en: "Amhara" },
  { value: "Tigray", am: "ትግራይ", en: "Tigray" },
  { value: "Somali", am: "ሱማሌ", en: "Somali" },
  { value: "Gurage", am: "ጉራጌ", en: "Gurage" },
  { value: "Sidama", am: "ሲዳማ", en: "Sidama" },
  { value: "Afar", am: "አፋር", en: "Afar" },
  { value: "Other", am: "ሌላ", en: "Other" },
] as const;

export const RELIGION_OPTIONS = [
  { value: "Muslim", am: "ሙስሊም", en: "Muslim" },
  { value: "Orthodox", am: "ኦርቶዶክስ", en: "Orthodox" },
  { value: "Protestant", am: "ፕሮቴስታንት", en: "Protestant" },
  { value: "Catholic", am: "ካቶሊክ", en: "Catholic" },
  { value: "Other", am: "ሌላ", en: "Other" },
] as const;

export const EDUCATION_OPTIONS = [
  { value: "None", am: "የለም", en: "None" },
  { value: "Primary", am: "የመጀመሪያ ደረጃ", en: "Primary" },
  { value: "Secondary", am: "ሁለተኛ ደረጃ", en: "Secondary" },
  { value: "TVET", am: "ቴክኒክና ሙያ", en: "TVET" },
  { value: "Bachelor", am: "ድግሪ", en: "Bachelor's" },
  { value: "Master", am: "ማስተርስ", en: "Master's" },
  { value: "Other", am: "ሌላ", en: "Other" },
] as const;

export const OCCUPATION_OPTIONS = [
  { value: "Employed", am: "ተቀጣሪ", en: "Employed" },
  { value: "SelfEmployed", am: "ራስ ሰራተኛ", en: "Self-employed" },
  { value: "Business", am: "ንግድ", en: "Business" },
  { value: "Unemployed", am: "ስራ አጥ", en: "Unemployed" },
  { value: "Student", am: "ተማሪ", en: "Student" },
  { value: "Retired", am: "ጡረተኛ", en: "Retired" },
  { value: "Other", am: "ሌላ", en: "Other" },
] as const;

export const ETHIOPIAN_REGIONS = [
  "Harari",
  "Addis Ababa",
  "Afar",
  "Amhara",
  "Benishangul-Gumuz",
  "Dire Dawa",
  "Gambela",
  "Oromia",
  "Sidama",
  "Somali",
  "South Ethiopia",
  "South West Ethiopia",
  "Tigray",
  "Central Ethiopia",
] as const;
