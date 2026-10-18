import { Type, validator, validators } from '@openmrs/esm-framework';

// Program uuids are site content and no RefApp demo uuids were confirmed, so distros add their own.
const COHORT_PROGRAMS_DEFAULT = [];

// Drug uuids are site content. The ARV ones are the formulary rows on the RefApp demo server; elsewhere
// they match nothing until a distro replaces them. The demo has no TLD Drug, so "on TLD" stays silent.
const COHORT_DRUG_GROUPS_DEFAULT = [
  {
    id: 'arv',
    label: 'ARVs',
    aliases: ['arv', 'arvs', 'art', 'antiretroviral', 'antiretrovirals'],
    drugUuids: [
      '8891ef84-08d3-5e23-8d81-f7a528a2591d', // Tenofovir
      '24c7b6a7-c317-588f-a50c-9ca12535388b', // Lamivudine
      'bfc93568-c9de-5a7b-998a-a57ea3af7e02', // Efavirenz
      '0216ff5f-7e98-5425-944b-e4792cfaea8c', // Nevirapine
      '5e0fb4d1-0a76-570c-aa23-9ab3e68f2d5e', // Abacavir
      'ff7cbf4a-ceb3-5044-9c02-02808f310dea', // Retrovir (zidovudine)
      '9247a9cd-6790-51b4-868f-aa83a740d617', // Stavudine
      '274aae77-31d2-53a0-9a2d-ec941d4e9624', // Didanosine
      '0800fada-8a96-52ac-ab8a-68f6f5cb119c', // Nelfinavir
      'b3a3db36-ba89-52fc-b35c-b26eb6b99324', // Lamivudine / zidovudine
      '8cea863d-e8a5-5b56-8269-162b444c309a', // Lamivudine / nevirapine / stavudine
      'bf171285-1691-11df-97a5-7038c432aabf', // Triomune-30
      '4d2618fd-5be3-5a4c-ad4b-58b8b2ed0a13', // Lopinavir / ritonavir
    ],
    cielConceptUuids: [
      '84796AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', // tenofovir disoproxil
      '78643AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', // lamivudine
      '165085AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', // dolutegravir
      'b944c518-10b4-4a93-a928-d0e4d10a66e4', // dolutegravir / lamivudine / tenofovir (CIEL 170671)
      '75523AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', // efavirenz
      '86663AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', // zidovudine
      '80586AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', // nevirapine
      '794AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', // lopinavir / ritonavir
      '70056AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', // abacavir
      '161361AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', // efavirenz / lamivudine / tenofovir
      '159809AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', // atazanavir / ritonavir
    ],
  },
  {
    id: 'tld',
    label: 'TLD',
    aliases: ['tld', 'tenofovir lamivudine dolutegravir'],
    drugUuids: [],
    cielConceptUuids: ['b944c518-10b4-4a93-a928-d0e4d10a66e4'],
  },
];

export const configSchema = {
  appearance: {
    _type: Type.String,
    _default: 'field',
    _description:
      '"field" keeps the search field visible in the header on desktop, with a field-shaped button on tablet and phone. "icon" collapses it to a magnifier until clicked, as the patient search did before.',
    _validators: [validators.oneOf(['field', 'icon'])],
  },
  patientSearch: {
    minSearchCharacters: {
      _type: Type.Number,
      _default: 2,
      _description: 'Characters needed before patient search runs.',
    },
    maxResults: {
      _type: Type.Number,
      _default: 5,
      _description: 'Patients shown in the omnibar. The full list is on the search page.',
    },
    showRecentPatients: {
      _type: Type.Boolean,
      _default: true,
      _description: 'Show recently viewed patients when the field is empty.',
    },
    includeDead: {
      _type: Type.Boolean,
      _default: true,
      _description: 'Include deceased patients in results.',
    },
    patientChartUrl: {
      _type: Type.String,
      _default: '${openmrsSpaBase}/patient/${patientUuid}/chart/',
      _description: 'Where choosing a patient goes.',
    },
  },
  chartLookup: {
    minSearchCharacters: {
      _type: Type.Number,
      _default: 2,
      _description: 'Characters needed before the concept dictionary is searched.',
    },
    maxConcepts: {
      _type: Type.Number,
      _default: 5,
      _description: 'Matching concepts to look up values for.',
    },
    resultsUrl: {
      _type: Type.String,
      _default: '${openmrsSpaBase}/patient/${patientUuid}/chart/Results',
      _description: 'Where choosing a chart value goes.',
    },
  },
  chartSearchSuggestion: {
    enabled: {
      _type: Type.Boolean,
      _default: true,
      _description: 'Offer an explicit ChartSearch workspace destination for question-like queries.',
    },
    minWords: {
      _type: Type.Number,
      _default: 3,
      _description: 'Words needed for a query to count as a question without a question word or question mark.',
      _validators: [
        validator(
          (value: number) => Number.isInteger(value) && value >= 2,
          'ChartSearch minWords must be a whole number of at least 2.',
        ),
      ],
    },
    workspaceName: {
      _type: Type.String,
      _default: 'ai-chat-workspace',
      _description: 'Registered ChartSearch workspace opened by the suggestion row.',
    },
  },
  destinations: {
    _type: Type.Array,
    _description: 'Pages and apps the omnibar can open. Adjust to match the apps in your distribution.',
    _elements: {
      _type: Type.Object,
      label: { _type: Type.String, _description: 'Shown to the user.' },
      path: {
        _type: Type.String,
        _description: 'A page on this site, passed to navigate(); ${openmrsSpaBase} is supported.',
      },
      description: { _type: Type.String, _default: '' },
      keywords: {
        _type: Type.Array,
        _elements: { _type: Type.String },
        _default: [],
        _description: 'Other words people use for this page.',
      },
      privilege: {
        _type: Type.String,
        _default: '',
        _description: 'If set, only users with this privilege see the destination.',
      },
    },
    _default: [
      { label: 'Home', path: '${openmrsSpaBase}/home', keywords: ['dashboard', 'start'] },
      {
        label: 'Register a patient',
        path: '${openmrsSpaBase}/patient-registration',
        keywords: ['new patient', 'add patient', 'registration'],
      },
      {
        label: 'Appointments',
        path: '${openmrsSpaBase}/home/appointments',
        keywords: ['booking', 'schedule', 'calendar'],
      },
      {
        label: 'Service queues',
        path: '${openmrsSpaBase}/home/service-queues',
        keywords: ['queue', 'triage', 'waiting'],
      },
      { label: 'Patient lists', path: '${openmrsSpaBase}/home/patient-lists', keywords: ['cohort', 'list'] },
      { label: 'Ward', path: '${openmrsSpaBase}/ward', keywords: ['inpatient', 'admit', 'admission', 'beds'] },
      { label: 'Bed management', path: '${openmrsSpaBase}/bed-management', keywords: ['beds', 'bed'] },
    ],
    _validators: [
      validator(
        (destinations: Array<{ path?: string; label?: string }>) => destinations.every((d) => d.path && d.label),
        'Every destination needs a label and a path.',
      ),
    ],
  },
  cohortBuilder: {
    savedSearchMinCharacters: {
      _type: Type.Number,
      _default: 2,
      _description: 'Characters needed before saved cohorts and saved queries are searched by name.',
    },
    drugCriteriaEnabled: {
      _type: Type.Boolean,
      _default: false,
      _description:
        'Let the cohort parser understand drug groups ("on ARVs"). Off by default: the Cohort Builder searches drug orders with reporting.library.cohortDefinition.builtIn.drugOrderSearch, which no reporting release defines, so the search fails unless the server provides that definition.',
    },
    programs: {
      _type: Type.Array,
      _description:
        'Programs the cohort parser understands, as in "enrolled in HIV program". Aliases are matched as whole words.',
      _elements: {
        _type: Type.Object,
        uuid: { _type: Type.UUID, _description: 'The program uuid.' },
        label: { _type: Type.String, _description: 'Shown in the cohort description.' },
        aliases: { _type: Type.Array, _elements: { _type: Type.String }, _default: [] },
      },
      _default: COHORT_PROGRAMS_DEFAULT,
    },
    drugGroups: {
      _type: Type.Array,
      _description:
        'Drug groups the cohort parser understands, as in "on ARVs". "on <alias>" means a drug order for any of drugUuids that is active today. A group with no drugUuids is never offered.',
      _elements: {
        _type: Type.Object,
        id: { _type: Type.String },
        label: { _type: Type.String, _description: 'Shown in the cohort description.' },
        aliases: { _type: Type.Array, _elements: { _type: Type.String }, _default: [] },
        drugUuids: {
          _type: Type.Array,
          _elements: { _type: Type.String },
          _default: [],
          _description: 'Drug (formulary) uuids, which is what the cohort builder searches drug orders by.',
        },
        cielConceptUuids: {
          _type: Type.Array,
          _elements: { _type: Type.String },
          _default: [],
          _description: 'The CIEL concepts the group stands for, as a reference for filling in drugUuids. Not sent.',
        },
      },
      _default: COHORT_DRUG_GROUPS_DEFAULT,
    },
  },
};

export interface CohortProgram {
  uuid: string;
  label: string;
  aliases: Array<string>;
}

export interface CohortDrugGroup {
  id: string;
  label: string;
  aliases: Array<string>;
  drugUuids: Array<string>;
  cielConceptUuids: Array<string>;
}

export interface Destination {
  label: string;
  path: string;
  description: string;
  keywords: Array<string>;
  privilege: string;
}

export interface ChartSearchSuggestionConfig {
  enabled: boolean;
  minWords: number;
  workspaceName: string;
}

export interface OmnibarConfig {
  appearance: 'field' | 'icon';
  patientSearch: {
    minSearchCharacters: number;
    maxResults: number;
    showRecentPatients: boolean;
    includeDead: boolean;
    patientChartUrl: string;
  };
  chartLookup: {
    minSearchCharacters: number;
    maxConcepts: number;
    resultsUrl: string;
  };
  chartSearchSuggestion: ChartSearchSuggestionConfig;
  destinations: Array<Destination>;
  cohortBuilder: {
    savedSearchMinCharacters: number;
    drugCriteriaEnabled: boolean;
    programs: Array<CohortProgram>;
    drugGroups: Array<CohortDrugGroup>;
  };
}
