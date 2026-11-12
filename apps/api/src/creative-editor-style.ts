import {approvedBrandFont,resolveBrandTypography,type BrandTypography} from './brand-typography.js';

/** What the Create canvas offers first when the owner edits text: the brand's own palette and fonts. */
export type EditorBrandStyle={colors:string[];typography:BrandTypography|null};

const HEX=/#(?:[0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/gi;
const MAX_COLORS=8;
const fullHex=(value:string):string=>{
 const hex=value.slice(1).toLowerCase();
 return '#'+(hex.length===3?[...hex].map(c=>c+c).join(''):hex);
};

/** Only exact hex colours and a supported font pairing from approved brand facts become editor choices;
 * any other wording stays context. */
export function editorBrandStyle(facts:readonly {field:string;value:string}[]):EditorBrandStyle{
 const colors=[...new Set(facts.filter(f=>f.field==='colors').flatMap(f=>f.value.match(HEX)??[]).map(fullHex))].slice(0,MAX_COLORS);
 return {colors,typography:resolveBrandTypography(approvedBrandFont(facts))??null};
}
