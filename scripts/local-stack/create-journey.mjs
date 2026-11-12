// The power-user Create journey, run after the guided journey on the same business:
// ask the Create chat for an image post → it opens on the canvas → edit layers (text, brand font,
// brand colour, keyboard nudge, undo) → save → unsaved edits survive a reload → regenerate with a
// new headline → two alternatives, keep one → add to the calendar → approve → the calendar shows
// it approved → a story at 9:16 and a carousel from the same chat. Screenshots go to work/create-shots.
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {expect} from '@playwright/test';
import {ROOT,loadSecrets} from './config.mjs';
import {adminPool} from './containers.mjs';

const SHOTS=join(ROOT,'work/create-shots');
const LONG=300000;

async function signals(state,businessId){
 if(!state)return null;
 const pool=adminPool({...state,secrets:loadSecrets()},1);
 try{return (await pool.query('SELECT kind,count(*)::int AS n FROM app.creative_signals WHERE brand_id=$1 GROUP BY kind ORDER BY kind',[businessId])).rows.map(r=>`${r.kind}:${r.n}`).join(', ');}
 finally{await pool.end();}
}

export async function runCreateJourney({page,base,businessId,step,state}){
 mkdirSync(SHOTS,{recursive:true});
 let n=0;
 const shot=async name=>{const file=join(SHOTS,`${String(++n).padStart(2,'0')}-${name}.png`);await page.screenshot({path:file,fullPage:true});return file;};
 const creative=()=>page.getByRole('region',{name:'Your creative'});
 const send=async text=>{const composer=page.getByRole('textbox',{name:'Message Desvio'});await expect(composer).toBeEnabled({timeout:LONG});await composer.fill(text);await page.getByRole('button',{name:'Send message'}).click();};
 const before=await signals(state,businessId);

 await step('create: chat request becomes an image on the canvas',async()=>{
  await page.goto(`${base}/b/${businessId}/create`);
  await expect(page.getByRole('textbox',{name:'Message Desvio'})).toBeEnabled({timeout:60000});
  await shot('create-start');
  await send('Create an Instagram post announcing our new cardamom bun, with a short headline.');
  await expect(page).toHaveURL(/conversation=/,{timeout:60000});
  await expect(creative().getByRole('button',{name:'Download PNG'})).toBeEnabled({timeout:LONG});
  await shot('create-image-on-canvas');
  // Designed (in-image) headlines leave no text layer; a power user adds an editable one.
  if(!await creative().getByLabel('Layer text').count())await creative().getByRole('button',{name:'Add text layer'}).click();
  await expect(creative().getByLabel('Layer text')).toBeVisible();
 });

 await step('create: edit text, brand font and colour, nudge with the keyboard, undo, save',async()=>{
  const c=creative();
  const text=c.getByLabel('Layer text');
  await text.fill('Cardamom buns are back');
  await c.getByLabel('Post caption').fill('Cardamom buns are back from Saturday. Come early.');
  await c.getByRole('combobox',{name:'Font'}).click();await page.getByRole('option',{name:'Playfair Display',exact:true}).click();
  const swatch=c.getByRole('button',{name:/^Brand colour 1 text$|^White text$/}).first();await swatch.click();
  const left=c.getByLabel('Left position');const x=Number(await left.inputValue());
  await c.getByRole('group',{name:'Selected layer'}).getByRole('button').first().click();
  await c.locator('.creative-surface').click();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(left).toHaveValue(String(x+10));
  await page.keyboard.press(process.platform==='darwin'?'Meta+z':'Control+z');
  await expect(left).toHaveValue(String(x));
  await expect(c.getByRole('status').filter({hasText:'Unsaved changes'})).toBeVisible();
  await shot('canvas-editing-unsaved');
  await page.keyboard.press(process.platform==='darwin'?'Meta+s':'Control+s');
  await expect(c.getByRole('status').filter({hasText:/^Saved$/})).toBeVisible({timeout:60000});
  await page.reload();
  await expect(creative().getByLabel('Layer text')).toHaveValue('Cardamom buns are back',{timeout:60000});
  await shot('canvas-saved-after-reload');
 });

 await step('create: unsaved edits survive a reload',async()=>{
  await creative().getByLabel('Layer text').fill('Warm from the oven at 7am');
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.getByText('We restored your unsaved edits from this device.')).toBeVisible({timeout:60000});
  await expect(creative().getByLabel('Layer text')).toHaveValue('Warm from the oven at 7am');
  await creative().getByRole('button',{name:'Discard edits'}).click();
  await expect(creative().getByLabel('Layer text')).toHaveValue('Cardamom buns are back');
 });

 await step('create: regenerate with a new headline',async()=>{
  const c=creative();
  await c.getByRole('button',{name:'Regenerate',exact:true}).click();
  await c.getByLabel('New headline').fill('Cardamom season starts today');
  await c.getByRole('button',{name:'Regenerate with new headline'}).click();
  await expect(page.getByText('Regenerate this image with the new headline',{exact:false}).first()).toBeVisible({timeout:60000});
  await expect(page.getByText('I’ll revise the current image',{exact:false})).toBeVisible({timeout:LONG});
  await expect(creative().getByRole('status').filter({hasText:'Saved · version 3'})).toBeVisible({timeout:LONG});
  await shot('regenerated');
 });

 await step('create: two alternatives, keep one',async()=>{
  await creative().getByRole('button',{name:'Make 2 alternatives'}).click();
  const alternatives=page.getByRole('region',{name:'Alternatives'});
  await expect(alternatives).toBeVisible({timeout:LONG});
  await expect(alternatives.getByText('Keep the one you like best.')).toBeVisible({timeout:LONG});
  await expect(alternatives.getByRole('listitem')).toHaveCount(3);
  await shot('alternatives');
  await alternatives.getByRole('button',{name:'Keep alternative 1'}).click();
  await expect(page.getByText('Kept your chosen alternative.',{exact:false})).toBeVisible({timeout:60000});
  await expect(page.getByRole('region',{name:'Alternatives'})).toHaveCount(0,{timeout:60000});
 });

 let when;
 await step('create: add to the calendar, approve, and the calendar shows it approved',async()=>{
  const c=creative();
  await c.getByRole('button',{name:'Add to calendar'}).click();
  const form=page.getByRole('form',{name:'Add to calendar'});
  const day=await form.getByLabel('Date').inputValue();
  await form.getByLabel(/^Time \(/).fill('10:30');
  await form.getByRole('button',{name:'Add to calendar'}).click();
  await expect(page.getByText('Added to your calendar for',{exact:false})).toBeVisible({timeout:60000});
  await expect(c.getByText(/^On calendar · /)).toBeVisible();
  when=day;
  await shot('on-calendar');
  await c.getByRole('button',{name:'Approve post'}).click();
  await expect(page.getByText('The calendar post is approved',{exact:false})).toBeVisible({timeout:60000});
  await shot('approved');
  const link=await c.getByRole('link',{name:'Open in calendar'}).getAttribute('href');
  await page.goto(new URL(link,base).href);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Approved',{exact:true}).first()).toBeVisible({timeout:60000});
  await shot('calendar-approved');
  return `scheduled ${when} 10:30`;
 });

 await step('create: a story is made at 9:16 from the chat',async()=>{
  await page.goto(`${base}/b/${businessId}/create`);
  await send('Create an Instagram story inviting people to taste the cardamom bun this Saturday.');
  await expect(creative().getByRole('button',{name:'Download PNG'})).toBeEnabled({timeout:LONG});
  await expect(creative().getByRole('region',{name:'Text layers'}).getByText('1080 × 1920',{exact:true})).toBeVisible({timeout:60000});
  await shot('story');
 });

 await step('create: a carousel is made from the chat',async()=>{
  await page.goto(`${base}/b/${businessId}/create`);
  await send('Create a 3-slide carousel on how our cardamom buns are made.');
  await expect(page.getByRole('progressbar',{name:'Saved carousel slides'}).first()).toHaveAttribute('value','3',{timeout:LONG});
  await shot('carousel');
 });

 await step('create: decisions were recorded as learning signals',async()=>{
  const after=await signals(state,businessId);
  if(after===null)return 'not checked (no database access)';
  for(const kind of ['edited','regenerated','rejected','approved'])if(!after.includes(kind+':'))throw new Error(`no ${kind} signal; before ${before}; after ${after}`);
  return `before {${before}} after {${after}}`;
 });
}
