import React from 'react';
import styles from './views.scss';

interface TrendProps {
  /** Oldest first. */
  points: Array<{ time: number; value: number }>;
  label: string;
}

const width = 320;
const height = 56;
const pad = 4;

/** A small line of numeric values over time, drawn inline: no chart library and no request. */
export const Trend: React.FC<TrendProps> = ({ points, label }) => {
  const times = points.map((point) => point.time);
  const values = points.map((point) => point.value);
  const [minTime, maxTime] = [Math.min(...times), Math.max(...times)];
  const [minValue, maxValue] = [Math.min(...values), Math.max(...values)];
  const x = (time: number) =>
    maxTime === minTime ? width / 2 : pad + ((time - minTime) / (maxTime - minTime)) * (width - 2 * pad);
  const y = (value: number) =>
    maxValue === minValue ? height / 2 : pad + (1 - (value - minValue) / (maxValue - minValue)) * (height - 2 * pad);
  const line = points.map((point) => `${x(point.time).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ');

  return (
    <svg className={styles.trend} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <polyline points={line} className={styles.trendLine} />
      {points.map((point, index) => (
        <circle key={index} cx={x(point.time)} cy={y(point.value)} r={2.5} className={styles.trendPoint} />
      ))}
    </svg>
  );
};
