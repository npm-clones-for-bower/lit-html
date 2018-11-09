/**
 * @license
 * Copyright (c) 2017 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at
 * http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at
 * http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */
import { directive, NodePart, removeNodes, reparentNodes } from '../lit-html.js';
class KeyedNodePart extends NodePart {
    constructor(templateFactory, key) {
        super(templateFactory);
        this.key = key;
    }
}
function createPart(parentPart, result, beforePart) {
    const container = parentPart.startNode.parentNode;
    const beforeNode = beforePart ? beforePart.startNode : parentPart.endNode;
    const startNode = document.createComment('');
    const endNode = document.createComment('');
    container.insertBefore(startNode, beforeNode);
    container.insertBefore(endNode, beforeNode);
    const newPart = new KeyedNodePart(parentPart.templateFactory, result.key);
    newPart.insertAfterNode(startNode);
    updatePart(newPart, result);
    return newPart;
}
function updatePart(part, result) {
    part.setValue(result);
    part.commit();
    return part;
}
function movePart(parentPart, partToMove, beforePart) {
    const container = parentPart.startNode.parentNode;
    const beforeNode = beforePart ? beforePart.startNode : parentPart.endNode;
    const endNode = partToMove.endNode.nextSibling;
    if (endNode !== beforeNode) {
        reparentNodes(container, partToMove.startNode, endNode, beforeNode);
    }
}
function removePart(part) {
    removeNodes(part.startNode.parentNode, part.startNode, part.endNode.nextSibling);
}
function createKeyToIndexMap(items, start, end) {
    const map = new Map();
    for (let i = start; i <= end; i++) {
        const item = items[i];
        if (item !== null) {
            map.set(item.key, i);
        }
    }
    return map;
}
function removeUnusedOldParts(oldParts, oldPartKeyToIndexMap, newResults, newStartIndex, newEndIndex) {
    let removed = 0;
    const newResultKeyToIndexMap = createKeyToIndexMap(newResults, newStartIndex, newEndIndex);
    for (let [key, oldPartIdx] of oldPartKeyToIndexMap) {
        if (!newResultKeyToIndexMap.has(key)) {
            // parts in this range are guaranteed to be non-null
            const oldPart = oldParts[oldPartIdx];
            removePart(oldPart);
            oldParts[oldPartIdx] = null;
            removed++;
        }
    }
    return Boolean(removed);
}
const partListCache = new WeakMap();
export function repeat(items, keyFnOrTemplate, template) {
    let keyFn;
    if (arguments.length < 3) {
        template = keyFnOrTemplate;
    }
    else {
        keyFn = keyFnOrTemplate;
    }
    return directive((directivePart) => {
        // Old part list is retrieved from the last render at this part
        let oldParts = partListCache.get(directivePart) || [];
        // New result list is eagerly generated from items and marked with its key
        const newResults = [];
        let index = 0;
        for (const item of items) {
            let result = newResults[index] = template(item, index);
            result.key = keyFn ? keyFn(item) : index;
            index++;
        }
        // New part list will be built up as we go (either reused from old parts or
        // created for new keys in this render)
        const newParts = [];
        // Head and tail pointers to new results and old parts
        let oldStartIndex = 0;
        let oldStartPart = oldParts[0];
        let oldEndIndex = oldParts.length - 1;
        let oldEndPart = oldParts[oldEndIndex];
        let newStartIndex = 0;
        let newStartResult = newResults[0];
        let newEndIndex = newResults.length - 1;
        let newEndResult = newResults[newEndIndex];
        // key-to-index map for old parts will be lazily generated only when needed
        let oldPartKeyToIndexMap;
        while (oldStartIndex <= oldEndIndex && newStartIndex <= newEndIndex) {
            if (oldStartPart == null) {
                // Old part at head has already been used; skip
                oldStartPart = oldParts[++oldStartIndex];
            }
            else if (oldEndPart == null) {
                // Old part at tail has already been used; skip
                oldEndPart = oldParts[--oldEndIndex];
            }
            else if (oldStartPart.key == newStartResult.key) {
                // Old head matches new head; update in place
                newParts[newStartIndex] = updatePart(oldStartPart, newStartResult);
                oldStartPart = oldParts[++oldStartIndex];
                newStartResult = newResults[++newStartIndex];
            }
            else if (oldEndPart.key == newEndResult.key) {
                // Old tail matches new tail; update in place
                newParts[newEndIndex] = updatePart(oldEndPart, newEndResult);
                oldEndPart = oldParts[--oldEndIndex];
                newEndResult = newResults[--newEndIndex];
            }
            else if (oldStartPart.key == newEndResult.key) {
                // Old head matches new tail; update and move to new tail
                newParts[newEndIndex] = updatePart(oldStartPart, newEndResult);
                movePart(directivePart, oldStartPart, newParts[newEndIndex + 1]);
                oldStartPart = oldParts[++oldStartIndex];
                newEndResult = newResults[--newEndIndex];
            }
            else if (oldEndPart.key == newStartResult.key) {
                // Old tail matches new head; update and move to new head
                newParts[newStartIndex] = updatePart(oldEndPart, newStartResult);
                movePart(directivePart, oldEndPart, oldStartPart);
                oldEndPart = oldParts[--oldEndIndex];
                newStartResult = newResults[++newStartIndex];
            }
            else {
                // Lazily generate key-to-index map for remaining oldParts
                if (oldPartKeyToIndexMap == undefined) {
                    oldPartKeyToIndexMap = createKeyToIndexMap(oldParts, oldStartIndex, oldEndIndex);
                    // Try removing any unused old parts (continue, since this may
                    // have unblocked the linear part of the update)
                    if (removeUnusedOldParts(oldParts, oldPartKeyToIndexMap, newResults, newStartIndex, newEndIndex)) {
                        oldStartPart = oldParts[oldEndIndex];
                        oldEndPart = oldParts[oldStartIndex];
                        continue;
                    }
                }
                const oldIndex = oldPartKeyToIndexMap.get(newEndResult.key);
                const oldPart = oldIndex !== undefined ? oldParts[oldIndex] : null;
                if (oldPart == null) {
                    // No old part for this result; create a new one and insert it
                    newParts[newEndIndex] = createPart(directivePart, newEndResult, newParts[newEndIndex + 1]);
                }
                else {
                    // Reuse old part
                    newParts[newEndIndex] = updatePart(oldPart, newEndResult);
                    movePart(directivePart, oldPart, newParts[newEndIndex + 1]);
                    // This marks the old part as having been used, so that it will be 
                    // skipped im the first two checks above
                    oldParts[oldIndex] = null;
                }
                newEndResult = newResults[--newEndIndex];
            }
        }
        // Add parts for remaining results
        while (newStartIndex <= newEndIndex) {
            newParts[newStartIndex] = createPart(directivePart, newStartResult, oldStartPart);
            newStartResult = newResults[++newStartIndex];
        }
        // Remove any unused old parts
        if (!oldPartKeyToIndexMap) {
            while (oldStartIndex <= oldEndIndex) {
                if (oldStartPart !== null) {
                    removePart(oldStartPart);
                    oldStartPart = oldParts[++oldStartIndex];
                }
            }
        }
        // Save order of new parts for next round
        partListCache.set(directivePart, newParts);
    });
}
//# sourceMappingURL=repeatSimple.js.map