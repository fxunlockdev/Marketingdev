"use client";

import {Badge} from '@astryxdesign/core/Badge';

export type StatusTone = 'neutral' | 'info' | 'positive' | 'caution' | 'danger';
export type Status =
  | 'not_started' | 'in_progress' | 'draft_ready' | 'in_review' | 'approved'
  | 'needs_attention' | 'scheduled' | 'published' | 'failed';

const statuses: Record<Status, {label: string; tone: StatusTone}> = {
  not_started: {label: 'Not generated yet', tone: 'neutral'},
  in_progress: {label: 'In progress', tone: 'info'},
  draft_ready: {label: 'Draft ready', tone: 'info'},
  in_review: {label: 'Ready for review', tone: 'caution'},
  approved: {label: 'Approved', tone: 'positive'},
  needs_attention: {label: 'Needs attention', tone: 'caution'},
  scheduled: {label: 'Scheduled', tone: 'info'},
  published: {label: 'Published', tone: 'positive'},
  failed: {label: 'Failed', tone: 'danger'},
};

const astryxVariant: Record<StatusTone, 'neutral' | 'info' | 'success' | 'warning' | 'error'> = {
  neutral: 'neutral', info: 'info', positive: 'success', caution: 'warning', danger: 'error',
};

/** Tone for a status, for callers that colour something other than a badge. */
export function statusTone(status: Status): StatusTone {
  return statuses[status].tone;
}

/**
 * A status as a badge: colour carries the meaning, the label and dot shape
 * carry it for people who cannot rely on colour. Pass `label` to keep a more
 * specific phrase ("Creating video") while using the status colour.
 */
export function StatusBadge({status, label, className = ''}: {status: Status; label?: string; className?: string}) {
  const {label: fallback, tone} = statuses[status];
  return (
    <Badge
      variant={astryxVariant[tone]}
      label={label ?? fallback}
      icon={<span className="ui-badge-dot" aria-hidden="true" />}
      data-tone={tone}
      data-status={status}
      className={`ui-badge ${className}`.trim()}
    />
  );
}
