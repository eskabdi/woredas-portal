import JsBarcode from "jsbarcode";

/**
 * Code 128 barcode for the credential number on the front of an ID card.
 *
 * The credential number is 13 digits, which Code 128's Set C packs two at a time
 * — roughly half the width Code 39 needs for the same value. That headroom is
 * what lets the barcode fit alongside the photo and still print reliably.
 */

/** Printed width of the barcode on the card. */
export const BARCODE_WIDTH_MM = 48;

/**
 * Printed height of the bars themselves, excluding the caption.
 *
 * Short for a Code 128 symbol, but the card front has a header, a photo and five
 * data rows to fit into 54mm. Height affects only how forgiving the symbol is of
 * a skewed scan, not whether it decodes — the X-dimension is what matters.
 */
export const BARCODE_HEIGHT_MM = 7;

/**
 * Narrowest bar the card printer and a phone camera can both resolve.
 *
 * 250 µm is the camera-scanning floor; laser scanners manage 190 µm. At 48 mm a
 * 13-digit number lands around 335 µm, so this is a guard against a future
 * change — a longer number or a narrower slot — rather than a limit we sit near.
 */
export const MIN_X_DIMENSION_UM = 250;

export class BarcodeTooDenseError extends Error {
  constructor(
    readonly value: string,
    readonly xDimensionUm: number,
    readonly widthMm: number,
  ) {
    super(
      `Barcode for "${value}" would print at ${xDimensionUm.toFixed(0)}um per module ` +
        `at ${widthMm}mm wide, below the ${MIN_X_DIMENSION_UM}um floor. ` +
        `Widen the barcode or shorten the value.`,
    );
    this.name = "BarcodeTooDenseError";
  }
}

export interface BarcodeMetrics {
  /** Total modules including quiet zones. */
  modules: number;
  /** Width of one module in micrometres, as printed. */
  xDimensionUm: number;
}

/**
 * Renders the credential number into an existing <svg> element, sized in
 * millimetres so it prints at a known physical density.
 *
 * Throws rather than emitting a barcode too dense to scan: a card that looks
 * right and fails at the counter is worse than one that never gets printed.
 */
export function renderCredentialBarcode(
  svg: SVGSVGElement,
  value: string,
  widthMm: number = BARCODE_WIDTH_MM,
): BarcodeMetrics {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Credential barcode expects digits only, got "${value}"`);
  }

  // Render one pixel per module first, so the element's own width tells us the
  // module count rather than us predicting jsbarcode's Set A/B/C switching.
  JsBarcode(svg, value, {
    format: "CODE128",
    width: 1,
    height: 100,
    margin: 10, // quiet zone, in modules
    displayValue: false,
  });

  // jsbarcode writes width as "143px", so read the module count from the
  // viewBox it also sets — that one is plain numbers.
  const viewBox = (svg.getAttribute("viewBox") ?? "").split(/\s+/).map(Number);
  const modules = viewBox[2];
  const renderedHeight = viewBox[3];
  if (!modules || !renderedHeight) {
    throw new Error("Barcode render produced no dimensions");
  }

  const xDimensionUm = (widthMm / modules) * 1000;
  if (xDimensionUm < MIN_X_DIMENSION_UM) {
    throw new BarcodeTooDenseError(value, xDimensionUm, widthMm);
  }

  // Scale to physical units: the viewBox keeps the module grid intact while the
  // width/height attributes fix how large it actually prints.
  svg.setAttribute("width", `${widthMm}mm`);
  svg.setAttribute("height", `${BARCODE_HEIGHT_MM}mm`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("shape-rendering", "crispEdges");

  return { modules, xDimensionUm };
}

/** Strips the hyphens the database stores, e.g. "04-11-26-000001-2". */
export function credentialDigits(credentialNumber: string): string {
  return (credentialNumber ?? "").replace(/-/g, "");
}
