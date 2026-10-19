import { Type } from '@openmrs/esm-framework';

export const configSchema = {
  minSearchCharacters: {
    _type: Type.Number,
    _default: 2,
    _description: 'Characters needed before the query store index is searched.',
  },
  resultsUrl: {
    _type: Type.String,
    _default: '${openmrsSpaBase}/patient/${patientUuid}/chart/Results',
    _description: 'Where choosing a chart value goes.',
  },
  warmOnChartOpen: {
    _type: Type.Boolean,
    _default: true,
    _description:
      'Ask the query store to index a chart when the user opens it, so the first search there finds it ready.',
  },
};

export interface QuerystoreConfig {
  minSearchCharacters: number;
  resultsUrl: string;
  warmOnChartOpen: boolean;
}
