/**
 * Import public API: .docx bytes → schema doc.
 */

import type { Node as PMNode } from 'prosemirror-model';
import { Docx } from '../ooxml/docx.js';
import { importDoc } from './importer.js';

export { importDoc } from './importer.js';

/**
 * Read a .docx byte buffer and return a ProseMirror doc.
 */
export async function fromDocx(bytes: Uint8Array | ArrayBuffer): Promise<PMNode> {
  const docx = await Docx.load(bytes);
  const documentXml = await docx.readText('word/document.xml');
  if (!documentXml) throw new Error('docx is missing word/document.xml');
  const relsXml = await docx.readText('word/_rels/document.xml.rels');
  return importDoc(documentXml, relsXml);
}
