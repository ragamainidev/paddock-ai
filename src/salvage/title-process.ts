/**
 * What it costs to put a rebuilt title on the car, by the state that issues
 * it. The tier default is a national band; a bidder who states a
 * jurisdiction gets that state's published inspection and title fees
 * instead, and one who does not keeps the band with the reason it is still
 * a band. Registration and use tax are separate and larger, and stay out of
 * every number here, exactly as the tier default does.
 *
 * Twelve states are tabulated (the twelve largest salvage markets); every
 * other jurisdiction, `US-unspecified` included, falls back and says so
 * rather than borrowing a neighbor's fee. Each band is the published fee
 * at its low and the published fee plus the add-ons a rebuild actually
 * meets — a re-inspection, a private inspection station's own charge, a
 * safety certificate — at its high. Sources are in the basis strings and
 * docs/salvage-economics.md §13 (SPEC 44).
 */

export type TitleProcess = { low: number; high: number; basis: string };
export type StateTitleProcess = TitleProcess & { tabulated: boolean };

// A US state code as the buyer profile writes it (`US-CA`); anything else,
// `US-unspecified` included, is not a tabulated jurisdiction.
const STATE_CODE = /^US-[A-Z]{2}$/;

const SEPARATE = 'registration and use tax are separate (docs/salvage-economics.md §13)';

export const TITLE_PROCESS: Record<string, TitleProcess> = {
  'US-CA': {
    low: 375,
    high: 700,
    basis: `US-CA California revived salvage: $50 DMV salvage/dismantled inspection plus the Vehicle Safety Systems Inspection that replaced the brake-and-lamp certificate in September 2024, quoted $295–500 by BAR stations, plus title and VIN verification; ${SEPARATE}. https://www.dmv.ca.gov/portal/handbook/vehicle-industry-registration-procedures-manual-2/salvage-nonrepairable-junk-vehicles/revived-salvage-california-record/`,
  },
  'US-TX': {
    low: 140,
    high: 300,
    basis: `US-TX Texas rebuilt salvage: $65 rebuilt salvage fee (43 Tex. Admin. Code §217.89) plus the $28–33 title application, the $8 salvage title application, and a ~$40 anti-theft inspection; ${SEPARATE}. https://www.law.cornell.edu/regulations/texas/43-Tex-Admin-Code-SS-217-89`,
  },
  'US-FL': {
    low: 130,
    high: 300,
    basis: `US-FL Florida rebuilt title: $40 FLHSMV rebuilt inspection ($20 per re-inspection) plus salvage and title fees; private Pilot Rebuilt Vehicle Inspection Program stations post $110–130 instead; ${SEPARATE}. https://flrules.org/gateway/readRefFile.asp?refId=15232&filename=TL-37.pdf`,
  },
  'US-NY': {
    low: 250,
    high: 400,
    basis: `US-NY New York rebuilt salvage: $200 with an MV-907A salvage certificate ($150 anti-theft examination plus $50 title), $205 with any other proof of ownership; a missed appointment costs another $150; ${SEPARATE}. https://dmv.ny.gov/salvage/the-salvage-vehicle-examination`,
  },
  'US-PA': {
    low: 150,
    high: 600,
    basis: `US-PA Pennsylvania reconstructed vehicle: an enhanced inspection at a station-set, unpublished price plus the title fee — the band is wide because PennDOT publishes no inspection price (assumption, no source, for the price itself); ${SEPARATE}. https://www.pa.gov/agencies/dmv/vehicle-services/inspection-and-safety-requirements/specially-constructed-reconstructed-modified-vehicle-inspection`,
  },
  'US-IL': {
    low: 225,
    high: 400,
    basis: `US-IL Illinois rebuilt title: $75–94 Secretary of State inspection plus the $150 title, a licensed rebuilder, and a second police inspection on cars eight model years or newer; ${SEPARATE}. https://www.law.cornell.edu/regulations/illinois/Ill-Admin-Code-tit-92-SS-1020.80`,
  },
  'US-OH': {
    low: 70,
    high: 150,
    basis: `US-OH Ohio rebuilt salvage: $50 Ohio State Highway Patrol salvage inspection and the $4 salvage title, both set by ORC 4505.11 (the inspection fee is forfeited on a missed appointment); the ~$15 rebuilt-salvage title itself is an assumption, no source, since that section does not set it; ${SEPARATE}. https://codes.ohio.gov/ohio-revised-code/section-4505.11`,
  },
  'US-GA': {
    low: 120,
    high: 250,
    basis: `US-GA Georgia rebuilt title: $100 statutory inspection per O.C.G.A. §40-3-37 — $118 to the Department of Revenue with the $18 title fee when a state inspector does it, or $18 to the Department plus the station's own ~$100–125 for a private inspection, and $100 again on a re-inspection; ${SEPARATE}. https://dor.georgia.gov/titles-rebuilt-or-restored-vehicles`,
  },
  'US-NC': {
    low: 60,
    high: 200,
    basis: `US-NC North Carolina rebuilt title: the State Highway Patrol Investigative Services Unit anti-theft inspection required on vehicles six model years old or newer, plus the title fee; NCDMV publishes neither amount on its salvage page, so the band is an assumption around the ~$50 inspection and ~$56 title that secondary guides report (assumption, no official source for the amounts); ${SEPARATE}. https://www.ncdot.gov/dmv/title-registration/special-cases/pages/default.aspx`,
  },
  'US-MI': {
    low: 100,
    high: 250,
    basis: `US-MI Michigan rebuilt title: $100 salvage vehicle inspection, charged again on a failure, plus the title fee; a scrap certificate cancels the VIN outright and no title follows; ${SEPARATE}. https://www.michigan.gov/sos/-/media/Project/Websites/sos/Vehicle/Salvage-Vehicle/tr13a.pdf`,
  },
  'US-WA': {
    low: 100,
    high: 250,
    basis: `US-WA Washington rebuilt title: $65 Washington State Patrol inspection under RCW 46.12.560 plus title and inspection-related fees; ${SEPARATE}. https://app.leg.wa.gov/rcw/default.aspx?cite=46.12.560`,
  },
  'US-AZ': {
    low: 55,
    high: 150,
    basis: `US-AZ Arizona restored salvage: $50 Level III ADOT inspection (+$5 when an Arizona VIN is assigned) plus the $4 title fee; ${SEPARATE}. https://azdot.gov/faq/how-do-i-apply-restored-salvage-title`,
  },
};

/**
 * The rebuilt-title process cost for one jurisdiction. A tabulated state
 * returns its published band; every other jurisdiction returns the tier
 * default it was given, with the reason on the basis so the reader knows
 * the number is national rather than local (SPEC 2).
 */
export function titleProcessFor(jurisdiction: string, fallback: TitleProcess): StateTitleProcess {
  const state = STATE_CODE.test(jurisdiction) ? TITLE_PROCESS[jurisdiction] : undefined;
  if (state) return { ...state, tabulated: true };
  return { ...fallback, basis: `${fallback.basis}; state not tabulated`, tabulated: false };
}
