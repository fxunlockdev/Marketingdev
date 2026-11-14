"use client";
import {useState} from 'react';
import styles from './gallery.module.css';
import {Section} from './foundations';
import {Button} from '../button';
import {Card, CardHeader} from '../card';
import {Field, Input, Textarea} from '../field';
import {Select} from '../select';
import {Checkbox, Switch} from '../toggle';
import {SegmentedControl, Tabs} from '../tabs';
import {Badge, CountBadge} from '../badge';
import {Text} from '../text';
import {Stagger} from '../motion';
import {ArrowRightIcon, CalendarIcon, PlusIcon, SearchIcon, SparkIcon} from '../icons';

const CHANNELS = [{value: 'instagram', label: 'Instagram'}, {value: 'linkedin', label: 'LinkedIn'}, {value: 'facebook', label: 'Facebook'}, {value: 'x', label: 'X', disabled: true}];
const VARIANTS = ['primary', 'secondary', 'ghost', 'destructive'] as const;

/** Buttons, cards and form controls in every state. */
export function Controls() {
  const [channel, setChannel] = useState('instagram'), [view, setView] = useState('week'), [auto, setAuto] = useState(true);
  return (
    <>
      <Section id="buttons" title="Buttons" description="One primary action per view. Hover lifts, press springs down, focus shows one ring.">
        <Card>
          <div className={styles.stack}>
            <div className={styles.row}>
              <Button icon={<SparkIcon />}>Create</Button>
              <Button variant="secondary" icon={<CalendarIcon />}>Plan my content</Button>
              <Button variant="ghost" iconEnd={<ArrowRightIcon />}>View all</Button>
              <Button variant="destructive">Delete brand</Button>
            </div>
            <div className={styles.row}>
              <Button size="lg">Approve and start creating</Button>
              <Button size="sm" variant="secondary">Approve</Button>
              <Button size="sm" variant="ghost">Not right</Button>
              <Button variant="secondary" icon={<PlusIcon />} aria-label="Add post" />
            </div>
            <div className={styles.row}>
              {VARIANTS.map(v => <Button key={v} variant={v} loading>Saving</Button>)}
            </div>
            <div className={styles.row}>
              {VARIANTS.map(v => <Button key={v} variant={v} disabled>Disabled</Button>)}
            </div>
          </div>
        </Card>
      </Section>

      <Section id="cards" title="Cards" description="Solid surfaces for content. The dark glass card is the one strong emphasis on a page.">
        <Stagger className={styles.grid}>
          <Card>
            <CardHeader title="Upcoming posts" description="Next 7 days" action={<Badge tone="positive" dot>On track</Badge>} />
            <Text tone="muted" size="callout">A solid surface with a hairline edge and a soft resting shadow.</Text>
          </Card>
          <Card tone="muted">
            <CardHeader title="Muted" description="For grouped or secondary content" />
            <Text tone="muted" size="callout">Sits one step back from the surface card.</Text>
          </Card>
          <Card tone="accent">
            <CardHeader title="Accent" description="A gentle highlight" />
            <Text tone="muted" size="callout">The pale green tint, used sparingly.</Text>
          </Card>
          <Card as="a" href="#cards" interactive>
            <CardHeader title="Interactive" description="The whole card is one link" action={<ArrowRightIcon />} />
            <Text tone="muted" size="callout">Lifts on hover, springs on press, rings on focus.</Text>
          </Card>
          <Card tone="inverse">
            <div className={styles.attention}>
              <CardHeader title="Needs your attention" description="2 things are waiting on you" action={<CountBadge count={2} tone="accent" label="2 items" />} />
              <ul className={styles.attentionList}>
                <li>Approve 4 posts for next week <ArrowRightIcon /></li>
                <li>Reconnect Instagram <ArrowRightIcon /></li>
              </ul>
              <div className={styles.row}><Button onDark>Review now</Button><Button onDark variant="ghost">Later</Button></div>
            </div>
          </Card>
        </Stagger>
      </Section>

      <Section id="forms" title="Forms" description="Inputs, selects, toggles and tabs share one height, one corner and one focus ring.">
        <div className={styles.gridWide}>
          <Card>
            <div className={styles.stack}>
              <Field label="Business name" hint="Shown on every post."><Input placeholder="Runwal Enterprises" defaultValue="Runwal Enterprises" /></Field>
              <Field label="Search" hint="With a leading icon."><Input leading={<SearchIcon />} placeholder="Search brand knowledge" /></Field>
              <Field label="Website" error="Enter a full address, like https://example.com"><Input defaultValue="runwal" /></Field>
              <Field label="Disabled"><Input disabled defaultValue="Not editable right now" /></Field>
              <Field label="What should this post be about?" hint="A sentence or two is enough."><Textarea placeholder="A new project near Hiranandani Estate…" /></Field>
            </div>
          </Card>
          <Card>
            <div className={styles.stack}>
              <Field label="Channel" hint="The menu is frosted glass and opens from the control."><Select value={channel} onValueChange={setChannel} options={CHANNELS} /></Field>
              <div className={styles.spec}><p className={styles.label}>Segmented control</p>
                <SegmentedControl aria-label="Calendar view" value={view} onValueChange={setView} options={[{value: 'day', label: 'Day'}, {value: 'week', label: 'Week'}, {value: 'month', label: 'Month'}, {value: 'list', label: 'List'}]} />
              </div>
              <div className={styles.spec}><p className={styles.label}>Toggles</p>
                <Switch checked={auto} onCheckedChange={setAuto}>Post approved content automatically</Switch>
                <Switch disabled>Disabled switch</Switch>
                <Checkbox defaultChecked>Include a call to action</Checkbox>
                <Checkbox indeterminate>Some channels selected</Checkbox>
                <Checkbox disabled>Disabled checkbox</Checkbox>
              </div>
              <div className={styles.spec}><p className={styles.label}>Tabs</p>
                <Tabs aria-label="Brand Kit sections" defaultValue="style" items={[
                  {value: 'media', label: 'Media', content: <Text tone="muted" size="callout">Photos and videos posts can use.</Text>},
                  {value: 'style', label: 'Style', content: <Text tone="muted" size="callout">Colours, fonts and looks.</Text>},
                  {value: 'voice', label: 'Voice', content: <Text tone="muted" size="callout">How posts should read.</Text>},
                ]} />
              </div>
            </div>
          </Card>
        </div>
      </Section>
    </>
  );
}
