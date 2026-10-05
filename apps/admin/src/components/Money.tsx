import { formatDecimal } from '../utils/format';

interface Props {
  value: string | null | undefined;
  unit?: string;
  minFraction?: number;
}

/** Decimal-string money display, right aligned with tabular figures. */
export const Money = ({ value, unit, minFraction }: Props) => (
  <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
    {formatDecimal(value, { minFraction })}
    {unit && value ? <span style={{ opacity: 0.65, marginLeft: 4 }}>{unit}</span> : null}
  </span>
);
