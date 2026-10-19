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
      _description: 'Chart values to show. Matching concepts with no value for this patient are skipped.',
    },
    maxCandidates: {
      _type: Type.Number,
      _default: 20,
      _description: 'Matching concepts, including the members of a matching set, to ask for values in one request.',
    },
    resultsUrl: {
      _type: Type.String,
      _default: '${openmrsSpaBase}/patient/${patientUuid}/chart/Results',
      _description: 'Where choosing a chart value goes.',
    },
    source: {
      _type: Type.String,
      _default: 'rest',
      _description:
        '"rest" uses the existing chart lookup via FHIR (default, no change). "querystore" replaces it with the querystore index, whose rows take the default highlight inside a chart as chart lookup rows do, a matching destination waiting up to 1.5 seconds for them, or 10 while the chart is still being indexed. "both" shows both panels side by side for comparison, and leaves the query store rows out of dedupe so a value both find shows twice.',
      _validators: [validators.oneOf(['rest', 'querystore', 'both'])],
    },
  },
  queryResults: {
    enterBehavior: {
      _type: Type.String,
      _default: 'submit',
      _description:
        'What Enter does inside a chart. "submit" (default) opens the chart\'s Query results section for what was typed, unless the user arrowed or pointed to a row since their last keystroke, in which case Enter opens that row. "open-highlight" keeps the earlier behaviour: Enter opens the highlighted row. Outside a chart, Enter always opens the highlighted row.',
      _validators: [validators.oneOf(['submit', 'open-highlight'])],
    },
    maxValuesPerConcept: {
      _type: Type.Number,
      _default: 50,
      _description: 'Values shown for each matching concept on the Query results page, newest first.',
    },
    questionMinWords: {
      _type: Type.Number,
      _default: 3,
      _description:
        'Words needed for a query to count as a question without a question word or question mark. Passed to Query results views as hints.looksLikeQuestion, and used for the bar\'s "and ask …" hint.',
      _validators: [
        validator(
          (value: number) => Number.isInteger(value) && value >= 2,
          'questionMinWords must be a whole number of at least 2.',
        ),
      ],
    },
  },
  commands: {
    _type: Type.Array,
    _description:
      'Changes to the slash commands the providers declare, by command id. "aliases" adds names people can type after the slash; "replaceAliases" drops the names from the providers and their translations first; "enabled": false removes the command, so its providers run for plain text only. An alias set here wins over the same alias declared for another command. Labels are translated with translation overrides for the provider\'s module, not here.',
    _elements: {
      _type: Type.Object,
      id: { _type: Type.String, _description: 'The command id, such as "lab". Never shown.' },
      aliases: {
        _type: Type.Array,
        _elements: { _type: Type.String },
        _default: [],
        _description: 'More names for the command, typed after the slash, one word each.',
      },
      replaceAliases: {
        _type: Type.Boolean,
        _default: false,
        _description: 'Use only the aliases given here.',
      },
      enabled: {
        _type: Type.Boolean,
        _default: true,
        _description: 'False removes the command from the bar.',
      },
    },
    _default: [],
    _validators: [
      validator(
        (commands: Array<{ id?: unknown }>) =>
          commands.every((command) => typeof command.id === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(command.id)),
        'Every command needs an id: lower-case letters, digits and hyphens, starting with a letter.',
      ),
    ],
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
      { label: 'Patient lists', path: '${openmrsSpaBase}/home/patient-lists', keywords: ['list'] },
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
};

export interface Destination {
  label: string;
  path: string;
  description: string;
  keywords: Array<string>;
  privilege: string;
}

export interface CommandConfig {
  id: string;
  aliases: Array<string>;
  replaceAliases: boolean;
  enabled: boolean;
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
    maxCandidates: number;
    resultsUrl: string;
    source: 'rest' | 'querystore' | 'both';
  };
  queryResults: {
    enterBehavior: 'submit' | 'open-highlight';
    maxValuesPerConcept: number;
    questionMinWords: number;
  };
  commands: Array<CommandConfig>;
  destinations: Array<Destination>;
}
