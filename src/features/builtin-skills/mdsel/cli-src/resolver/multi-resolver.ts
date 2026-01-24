/* eslint-disable */
import type { SelectorAST } from '../selector/types.js';
import type { ResolutionOutcome, DocumentTree } from './types.js';
import { resolveSingle } from './single-resolver.js';
import { SuggestionEngine } from './suggestions.js';

/**
 * Resolve a selector against multiple document trees.
 *
 * If the selector has a namespace, only the matching document is searched.
 * If no namespace is specified, all documents are searched and results
 * are merged.
 *
 * @param documents - Array of document trees with namespaces
 * @param selector - The parsed selector AST
 * @returns Resolution outcome (success or error)
 *
 * @example
 * ```typescript
 * const docs = [
 *   { namespace: 'doc1', tree: ast1, availableSelectors: ['doc1::heading:h1[0]'] },
 *   { namespace: 'doc2', tree: ast2, availableSelectors: ['doc2::heading:h1[0]'] }
 * ];
 * const selector = parseSelector('heading:h1[0]');
 * const result = resolveMulti(docs, selector);
 * // Returns results from both documents
 * ```
 */
export function resolveMulti(documents: DocumentTree[], selector: SelectorAST): ResolutionOutcome {
  // If selector has namespace, filter to that document only
  if (selector.namespace) {
    return resolveInNamespace(documents, selector);
  }

  // No namespace - resolve across all documents
  return resolveAcrossAll(documents, selector);
}

/**
 * Resolve selector in a specific namespace.
 */
function resolveInNamespace(documents: DocumentTree[], selector: SelectorAST): ResolutionOutcome {
  const targetDoc = documents.find((doc) => doc.namespace === selector.namespace);

  if (!targetDoc) {
    // Namespace not found - generate suggestions from available namespaces
    const availableNamespaces = documents.map((doc) => doc.namespace);
    const engine = new SuggestionEngine(availableNamespaces);
    const nsSuggestions = engine.getSuggestions(selector.namespace || '');

    const suggestions = nsSuggestions.map((s) => ({
      selector: `${s.selector}::${selectorToString(selector).replace(/^[^:]+::/, '')}`,
      distance: s.distance,
      ratio: s.ratio,
      reason: s.reason,
    }));

    return {
      success: false,
      error: {
        type: 'NAMESPACE_NOT_FOUND',
        message: `Namespace '${selector.namespace}' not found. Available namespaces: ${availableNamespaces.join(', ')}`,
        selector: selectorToString(selector),
        suggestions,
      },
    };
  }

  return resolveSingle(targetDoc.tree, targetDoc.namespace, selector, targetDoc.availableSelectors);
}

/**
 * Resolve selector across all documents.
 */
function resolveAcrossAll(documents: DocumentTree[], selector: SelectorAST): ResolutionOutcome {
  const outcomes: ResolutionOutcome[] = [];

  // Resolve in each document
  for (const doc of documents) {
    const outcome = resolveSingle(doc.tree, doc.namespace, selector, doc.availableSelectors);
    outcomes.push(outcome);
  }

  // Merge outcomes
  return mergeOutcomes(outcomes, selector, documents);
}

/**
 * Merge resolution outcomes from multiple documents.
 *
 * If any document succeeded, return success with all results.
 * If all failed, return error with combined suggestions.
 */
function mergeOutcomes(
  outcomes: ResolutionOutcome[],
  selector: SelectorAST,
  documents: DocumentTree[],
): ResolutionOutcome {
  const allResults: any[] = [];
  const allErrors: any[] = [];
  let hasSuccess = false;

  for (const outcome of outcomes) {
    if (outcome.success) {
      allResults.push(...outcome.results);
      hasSuccess = true;
    } else {
      allErrors.push(outcome.error);
    }
  }

  // If any results found, return success with all results
  if (hasSuccess) {
    return {
      success: true,
      results: allResults,
    };
  }

  // No results - return error with combined suggestions
  const allSelectors = documents.flatMap((doc) => doc.availableSelectors);
  const engine = new SuggestionEngine(allSelectors);
  const suggestions = engine.getSuggestions(selectorToString(selector));

  return {
    success: false,
    error: {
      type: 'SELECTOR_NOT_FOUND',
      message: 'No matches found in any document',
      selector: selectorToString(selector),
      suggestions,
    },
  };
}

/**
 * Convert selector AST to string.
 */
function selectorToString(selector: SelectorAST): string {
  let result = '';

  if (selector.namespace) {
    result += `${selector.namespace}::`;
  }

  result += selector.segments
    .map((seg) => {
      let segStr = seg.nodeType;
      if (seg.subtype) {
        segStr += `:${seg.subtype}`;
      }
      if (seg.index !== undefined) {
        segStr += `[${seg.index}]`;
      }
      return segStr;
    })
    .join('/');

  if (selector.queryParams && selector.queryParams.length > 0) {
    const params = selector.queryParams.map((p) => `${p.key}=${p.value}`).join('&');
    result += `?${params}`;
  }

  return result;
}
