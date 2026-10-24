import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calendarExport} from '../../dist/calendar-export.js';
const slot={id:'11111111-1111-4111-8111-111111111111',revision:3,planned_at:'2026-11-01T01:30:00Z',timezone:'America/New_York',channel:'linkedin',format:'video',state:'pending_review',brief:'A useful story',hook:'Hello',caption:'Saved caption'};
test('CSV export preserves exact saved times and neutralizes spreadsheet formulas',()=>{
 const result=calendarExport([{...slot,hook:'=HYPERLINK("bad")',caption:'line one\nline two, quoted "word"'}],'csv');
 assert.match(result.content, /2026-11-01T01:30:00.000Z/);assert.match(result.content,/America\/New_York/);
 assert.ok(result.content.includes('"\'=HYPERLINK(""bad"")"'));
 assert.ok(result.content.includes('"line one\nline two, quoted ""word"""'));
 for(const hook of ['+cmd','-cmd','@SUM(A1)','  =cmd','\tcmd'])assert.ok(calendarExport([{...slot,hook}],'csv').content.includes('"\''+hook+'"'));
});
test('iCalendar escapes untrusted content, folds UTF8 and keeps stable revision identity',()=>{
 const result=calendarExport([{...slot,hook:'🌿'.repeat(45)+'\nBEGIN:VEVENT',brief:'a,b;c\\d'}],'ics',new Date('2026-10-23T00:00:00Z'));
 assert.ok(result.content.includes('UID:'+slot.id+'@desvio\r\nSEQUENCE:3'));
 assert.ok(result.content.includes('DTSTART:20261101T013000Z'));
 const unfolded=result.content.replace(/\r\n /g,'');
 assert.ok(unfolded.includes('\\nBEGIN:VEVENT'));assert.ok(unfolded.includes('a\\,b\\;c\\\\d'));
 assert.equal(result.content.split('\r\n').filter(l=>l==='BEGIN:VEVENT').length,1);
 for(const line of result.content.split('\r\n'))assert.ok(Buffer.byteLength(line)<=75);
 assert.ok(result.content.includes('STATUS:TENTATIVE'));assert.ok(result.content.includes('TRANSP:TRANSPARENT'));
 assert.ok(calendarExport([{...slot,state:'cancelled'}],'ics').content.includes('STATUS:CANCELLED'));
 assert.throws(()=>calendarExport([{...slot,id:'bad\nBEGIN:VEVENT'}],'ics'));
});
