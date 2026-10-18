import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { DashboardExtension } from '@openmrs/esm-framework';
import { queryResultsPath } from './query-results-url';

/**
 * The left-nav entry, registered in `patient-chart-dashboard-slot` as other apps register their
 * dashboards (patient chart 13.x: chart-review.component.tsx reads `meta.slot` and `meta.path`). The
 * link drops the query, so following it shows this session's earlier queries rather than the last one.
 * The title is its own English key, as other dashboards' are, because the chart translates the page's
 * heading with the same string in its own namespace, where this app's keys don't exist.
 */
// t('Query results', 'Query results')
const QueryResultsLink: React.FC<{ basePath: string }> = ({ basePath }) => (
  <BrowserRouter>
    <DashboardExtension basePath={basePath} title="Query results" path={queryResultsPath} icon="omrs-icon-search" />
  </BrowserRouter>
);

export default QueryResultsLink;
