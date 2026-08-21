import { pdfjs } from "react-pdf";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

/**
 * One-time pdf.js worker registration. Importing this file for its side
 * effect is enough -- react-pdf's <Document>/<Page> read
 * pdfjs.GlobalWorkerOptions.workerSrc lazily on first render, so this only
 * needs to run once before either is used.
 *
 * The `?url` suffix is Vite's asset-import syntax: it bundles the worker as
 * a separate file and resolves to its final URL, in both `vite dev` and the
 * built output. Only ever imported from components that are themselves
 * lazy-loaded, so this never reaches the initial bundle.
 */
pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
