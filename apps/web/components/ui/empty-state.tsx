"use client";

import {EmptyState as AstryxEmptyState} from '@astryxdesign/core/EmptyState';
import type {ReactNode} from 'react';

export type EmptyStateProps = {
  title: string;
  /** One sentence: what will appear here and what makes it appear. */
  description?: string;
  /** At most one action; a `quiet` or `secondary` Button unless the view has no other primary. */
  action?: ReactNode;
  headingLevel?: 2 | 3 | 4;
  /** Inside a card or list, rather than filling a page. */
  compact?: boolean;
  className?: string;
};

/** What a list, panel or page shows when there is nothing in it yet. */
export function EmptyState({title, description, action, headingLevel = 3, compact = false, className = ''}: EmptyStateProps) {
  return (
    <AstryxEmptyState
      title={title}
      description={description}
      actions={action}
      headingLevel={headingLevel}
      isCompact={compact}
      data-compact={compact ? 'true' : undefined}
      className={`ui-empty ${className}`.trim()}
    />
  );
}
