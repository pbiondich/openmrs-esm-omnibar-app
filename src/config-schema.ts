import { Type, validator, validators } from '@openmrs/esm-framework';

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
      _default: '${openmrsSpaBase}patient/${patientUuid}/chart/',
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
      _default: '${openmrsSpaBase}patient/${patientUuid}/chart/Results',
      _description: 'Where choosing a chart value goes.',
    },
  },
  destinations: {
    _type: Type.Array,
    _description: 'Pages and apps the omnibar can open. Adjust to match the apps in your distribution.',
    _elements: {
      _type: Type.Object,
      label: { _type: Type.String, _description: 'Shown to the user.' },
      path: { _type: Type.String, _description: 'Passed to navigate(); ${openmrsSpaBase} is supported.' },
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
      { label: 'Home', path: '${openmrsSpaBase}home', keywords: ['dashboard', 'start'] },
      {
        label: 'Register a patient',
        path: '${openmrsSpaBase}patient-registration',
        keywords: ['new patient', 'add patient', 'registration'],
      },
      {
        label: 'Appointments',
        path: '${openmrsSpaBase}home/appointments',
        keywords: ['booking', 'schedule', 'calendar'],
      },
      {
        label: 'Service queues',
        path: '${openmrsSpaBase}home/service-queues',
        keywords: ['queue', 'triage', 'waiting'],
      },
      { label: 'Patient lists', path: '${openmrsSpaBase}home/patient-lists', keywords: ['cohort', 'list'] },
      { label: 'Ward', path: '${openmrsSpaBase}ward', keywords: ['inpatient', 'admit', 'admission', 'beds'] },
      { label: 'Bed management', path: '${openmrsSpaBase}bed-management', keywords: ['beds', 'bed'] },
    ],
    _validators: [
      validator(
        (destinations: Array<{ path?: string; label?: string }>) => destinations.every((d) => d.path && d.label),
        'Every destination needs a label and a path.',
      ),
    ],
  },
};

export interface Destination {
  label: string;
  path: string;
  description: string;
  keywords: Array<string>;
  privilege: string;
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
  destinations: Array<Destination>;
}
