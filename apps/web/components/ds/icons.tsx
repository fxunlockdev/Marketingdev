import type {ReactNode, SVGProps} from 'react';

/** One icon grid for the whole app: 20px box, 1.5px stroke, round caps, currentColor. */
function Glyph({children, ...props}: SVGProps<SVGSVGElement> & {children: ReactNode}) {
  return (
    <svg viewBox="0 0 20 20" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
      {children}
    </svg>
  );
}

type IconProps = SVGProps<SVGSVGElement>;
export const ChevronDownIcon = (p: IconProps) => <Glyph {...p}><path d="m5 7.5 5 5 5-5" /></Glyph>;
export const ChevronRightIcon = (p: IconProps) => <Glyph {...p}><path d="m7.5 5 5 5-5 5" /></Glyph>;
export const CheckIcon = (p: IconProps) => <Glyph {...p}><path d="m4.5 10.5 3.5 3.5 7.5-8" /></Glyph>;
export const MinusIcon = (p: IconProps) => <Glyph {...p}><path d="M5 10h10" /></Glyph>;
export const PlusIcon = (p: IconProps) => <Glyph {...p}><path d="M10 4.5v11M4.5 10h11" /></Glyph>;
export const CloseIcon = (p: IconProps) => <Glyph {...p}><path d="m5.5 5.5 9 9m0-9-9 9" /></Glyph>;
export const ArrowRightIcon = (p: IconProps) => <Glyph {...p}><path d="M4 10h12m-4.5-4.5L16 10l-4.5 4.5" /></Glyph>;
export const SearchIcon = (p: IconProps) => <Glyph {...p}><circle cx="9" cy="9" r="5.25" /><path d="m13 13 3.5 3.5" /></Glyph>;
export const InfoIcon = (p: IconProps) => <Glyph {...p}><circle cx="10" cy="10" r="7.25" /><path d="M10 9.25v4.25M10 6.6v.05" /></Glyph>;
export const AlertIcon = (p: IconProps) => <Glyph {...p}><path d="M10 3.5 17.25 16H2.75L10 3.5Z" /><path d="M10 8.5v3.25M10 13.9v.05" /></Glyph>;
export const SuccessIcon = (p: IconProps) => <Glyph {...p}><circle cx="10" cy="10" r="7.25" /><path d="m6.75 10.25 2.25 2.25 4.25-4.75" /></Glyph>;
export const HomeIcon = (p: IconProps) => <Glyph {...p}><path d="M3.5 9 10 3.5 16.5 9v7a.5.5 0 0 1-.5.5h-3.5v-4.25h-5V16.5H4a.5.5 0 0 1-.5-.5V9Z" /></Glyph>;
export const CalendarIcon = (p: IconProps) => <Glyph {...p}><rect x="3.5" y="4.5" width="13" height="12" rx="2.5" /><path d="M3.5 8.5h13M7 3v3M13 3v3" /></Glyph>;
export const SparkIcon = (p: IconProps) => <Glyph {...p}><path d="M10 3.5c.4 3.4 2.1 5.1 5.5 5.5-3.4.4-5.1 2.1-5.5 5.5-.4-3.400-2.1-5.100-5.500-5.500 3.400-.4 5.100-2.100 5.500-5.500Z" /></Glyph>;
export const CheckCircleIcon = SuccessIcon;
export const PaletteIcon = (p: IconProps) => <Glyph {...p}><path d="M10 3.25a6.75 6.75 0 1 0 0 13.5c1 0 1.500-.7 1.500-1.500 0-1.250-1-1.500-1-2.500s.75-1.500 1.750-1.500h1.500a3 3 0 0 0 3-3c0-2.900-3-5-6.750-5Z" /><path d="M6.75 10v.05M8.250 6.900v.05M11.750 6.500v.05" /></Glyph>;
export const LayersIcon = (p: IconProps) => <Glyph {...p}><path d="m10 3.5 6.750 3.500L10 10.500 3.250 7 10 3.500Z" /><path d="m3.250 10.250 6.750 3.500 6.750-3.500M3.250 13.250 10 16.750l6.750-3.500" /></Glyph>;
export const BulbIcon = (p: IconProps) => <Glyph {...p}><path d="M7.500 13.250a5 5 0 1 1 5 0V14.500h-5v-1.250ZM8 17h4" /></Glyph>;
export const SlidersIcon = (p: IconProps) => <Glyph {...p}><path d="M3.500 6h6m4 0h3M3.500 14h3m4 0h6" /><circle cx="11.500" cy="6" r="1.750" /><circle cx="8.500" cy="14" r="1.750" /></Glyph>;
export const PlugIcon = (p: IconProps) => <Glyph {...p}><path d="M7.500 3v3.500m5-3.500v3.500M5.500 6.500h9v2.750a4.500 4.500 0 0 1-9 0V6.500ZM10 13.750V17" /></Glyph>;
export const ChartIcon = (p: IconProps) => <Glyph {...p}><path d="M3.500 16.500h13M6 16.500v-5m4 5v-10m4 10v-7" /></Glyph>;
