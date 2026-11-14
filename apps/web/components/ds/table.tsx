import type {CSSProperties, ComponentPropsWithoutRef, ReactNode} from 'react';
import {visuallyHidden} from './a11y';
import {cx} from './cx';
import {ChevronDownIcon} from './icons';
import styles from './table.module.css';

export type CellAlign = 'start' | 'center' | 'end';
export type SortDirection = 'ascending' | 'descending' | 'none';

export interface ColumnSort {
  /** The column's current order. `none` means sortable but not the sorted column. */
  direction: SortDirection;
  /** Called when the header is pressed. The caller picks the next direction. */
  onSort: () => void;
}

type RegionName = {'aria-label': string; 'aria-labelledby'?: undefined} | {'aria-label'?: undefined; 'aria-labelledby': string};

export type TableContainerProps = Omit<ComponentPropsWithoutRef<'div'>, 'aria-label' | 'aria-labelledby' | 'role' | 'tabIndex'> & RegionName & {
  /** Caps the height (a token or a length) so the body scrolls under the sticky header. */
  maxHeight?: CSSProperties['maxHeight'];
};

/**
 * The table's surface. Scrolls sideways when the table is wider than the space, and takes keyboard
 * focus so it can be scrolled with the arrow keys. Name the region with `aria-label`, for example
 * "Campaign results", or point `aria-labelledby` at a visible heading.
 */
export function TableContainer({maxHeight, className, style, children, ...props}: TableContainerProps) {
  return (
    <div {...props} className={cx(styles.container, className)} style={maxHeight === undefined ? style : {...style, maxHeight}} role="region" tabIndex={0}>
      {children}
    </div>
  );
}

export interface TableProps extends ComponentPropsWithoutRef<'table'> {
  /** Says what the table holds. Shown as a muted line under the table. */
  caption?: ReactNode;
  /** Keep the caption for screen readers only. */
  captionHidden?: boolean;
}

export function Table({caption, captionHidden = false, className, children, ...props}: TableProps) {
  return (
    <table {...props} className={cx(styles.table, className)}>
      {caption !== undefined && caption !== null && <caption className={captionHidden ? visuallyHidden : styles.caption}>{caption}</caption>}
      {children}
    </table>
  );
}

export function THead({className, children, ...props}: ComponentPropsWithoutRef<'thead'>) {
  return <thead {...props} className={cx(styles.thead, className)}>{children}</thead>;
}

export function TBody({className, children, ...props}: ComponentPropsWithoutRef<'tbody'>) {
  return <tbody {...props} className={cx(styles.tbody, className)}>{children}</tbody>;
}

export function Tr({className, children, ...props}: ComponentPropsWithoutRef<'tr'>) {
  return <tr {...props} className={cx(styles.tr, className)}>{children}</tr>;
}

export interface ThProps extends Omit<ComponentPropsWithoutRef<'th'>, 'align'> {
  align?: CellAlign;
  /** Makes the header a sort button and sets `aria-sort`. */
  sort?: ColumnSort;
}

/** A header cell. `scope` defaults to "col". */
export function Th({align = 'start', sort, scope = 'col', className, children, ...props}: ThProps) {
  const sorted = sort && sort.direction !== 'none' ? sort.direction : props['aria-sort'];
  return (
    <th {...props} scope={scope} className={cx(styles.th, className)} data-align={align} aria-sort={sorted}>
      {sort ? (
        <button type="button" className={styles.sort} data-direction={sort.direction} onClick={sort.onSort}>
          <span>{children}</span>
          <ChevronDownIcon className={styles.sortIcon} />
        </button>
      ) : children}
    </th>
  );
}

export interface TdProps extends Omit<ComponentPropsWithoutRef<'td'>, 'align'> {
  align?: CellAlign;
  /** Right-aligns the cell and lines up the digits. */
  numeric?: boolean;
}

export function Td({align, numeric = false, className, children, ...props}: TdProps) {
  return (
    <td {...props} className={cx(styles.td, className)} data-align={align ?? (numeric ? 'end' : 'start')} data-numeric={numeric || undefined}>
      {children}
    </td>
  );
}
