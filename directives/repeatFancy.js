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
        this.pooledNodes = null;
        this.key = key;
    }
}
function createPart(parentPart, result, beforePart, pool, reuse) {
    const container = parentPart.startNode.parentNode;
    const beforeNode = beforePart ? beforePart.startNode : parentPart.endNode;
    let newPart;
    if (pool) {
        newPart = pool.get(result.key);
        if (!newPart && reuse && pool.size > 0) {
            newPart = pool.values().next().value;
        }
        if (newPart) {
            pool.delete(newPart.key);
            if (newPart.pooledNodes) {
                container.insertBefore(newPart.pooledNodes, beforeNode);
            }
            else {
                movePart(parentPart, newPart, beforePart);
            }
            newPart.key = result.key;
        }
    }
    if (!newPart) {
        const startNode = document.createComment('');
        const endNode = document.createComment('');
        container.insertBefore(startNode, beforeNode);
        container.insertBefore(endNode, beforeNode);
        newPart = new KeyedNodePart(parentPart.templateFactory, result.key);
        newPart.insertAfterNode(startNode);
    }
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
function removeOrPoolPart(part, pool) {
    if (pool) {
        pool.set(part.key, part);
    }
    else {
        removeNodes(part.startNode.parentNode, part.startNode, part.endNode.nextSibling);
    }
}
function poolPartNodes(part) {
    if (part.startNode.parentNode !== null) {
        let nodes = part.pooledNodes;
        if (!nodes) {
            nodes = part.pooledNodes = document.createDocumentFragment();
        }
        let start = part.startNode;
        let end = part.endNode.nextSibling;
        for (let n = start; n && n != end;) {
            const next = n.nextSibling;
            nodes.appendChild(n);
            n = next;
        }
    }
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
function removeUnusedOldParts(oldParts, oldPartKeyToIndexMap, newResults, newStartIndex, newEndIndex, pool) {
    let removed = 0;
    const newResultKeyToIndexMap = createKeyToIndexMap(newResults, newStartIndex, newEndIndex);
    for (let [key, oldPartIdx] of oldPartKeyToIndexMap) {
        if (!newResultKeyToIndexMap.has(key)) {
            // parts in this range are guaranteed to be non-null
            const oldPart = oldParts[oldPartIdx];
            removeOrPoolPart(oldPart, pool);
            oldParts[oldPartIdx] = null;
            removed++;
        }
    }
    return Boolean(removed);
}
function createOldIndexLIS(oldPartKeyToIndexMap, newResults, newStartIndex, newEndIndex) {
    let newIndexToOldIndex = [];
    for (let i = newStartIndex; i <= newEndIndex; i++) {
        newIndexToOldIndex[i] = oldPartKeyToIndexMap.get(newResults[i].key) || -1;
    }
    let tails = [newStartIndex];
    let prev = [-1];
    for (let i = newStartIndex + 1; i <= newEndIndex; i++) {
        const val = newIndexToOldIndex[i];
        if (val < 0) {
            continue;
        }
        let max = tails[tails.length - 1];
        if (val > newIndexToOldIndex[max]) {
            prev[i] = max;
            tails.push(i);
        }
        else {
            let start = 0, end = tails.length - 1;
            while (start < end) {
                const mid = start + end >> 1;
                const midVal = newIndexToOldIndex[tails[mid]];
                if (midVal < val) {
                    start = mid + 1;
                }
                else if (midVal > val) {
                    end = mid;
                }
                else {
                    start = mid;
                    break;
                }
            }
            prev[i] = tails[start - 1];
            tails[start] = i;
        }
    }
    const lis = new Set();
    for (let i = tails.length - 1, j = tails[tails.length - 1]; i >= 0; i--, j = prev[j]) {
        lis.add(newIndexToOldIndex[j]);
    }
    return lis;
}
const partListCache = new WeakMap();
export function repeat(items, keyFnOrTemplate, template, options) {
    let keyFn;
    if (arguments.length < 3) {
        template = keyFnOrTemplate;
    }
    else {
        keyFn = keyFnOrTemplate;
    }
    if (options == undefined) {
        options = {};
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
        // Optional pool to reuse items from; when `true` we make a pool and only
        // use on this update; otherwise user pool passed can be used across updates 
        let pool = options.pool || options.reuse ? new Map() : undefined;
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
        // set of indicies in longest incrementing subsequence of old items
        let oldIndexLIS = null;
        function log(msg) {
            return;
            if (oldParts.length == 0) {
                return;
            }
            const max = Math.max(oldParts.length, newResults.length);
            const pad = Math.floor(Math.log10(max)) + 2;
            console.log('+-' + '-'.repeat(max * pad));
            console.log('| ' + oldParts.map((_, i) => ((i == oldStartIndex && i == oldEndIndex) ? 'se' : i == oldStartIndex ? 's' : i == oldEndIndex ? 'e' : ' ').padStart(pad)).join(''));
            console.log('| ' + oldParts.map(o => (o ? o.key : '-').toString().padStart(pad)).join(''));
            console.log('| ' + newResults.map(o => o.key.toString().padStart(pad)).join(''));
            console.log('| ' + newResults.map((_, i) => ((i == newStartIndex && i == newEndIndex) ? 'se' : i == newStartIndex ? 's' : i == newEndIndex ? 'e' : ' ').padStart(pad)).join(''));
            oldIndexLIS && console.log('| lis: ' + Array.from(oldIndexLIS).sort((a, b) => a - b).join(' '));
            console.log('+-' + '-'.repeat(max * pad));
            console.log(msg);
        }
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
                log(`> Heads match ${oldStartIndex}`);
                newParts[newStartIndex] = updatePart(oldStartPart, newStartResult);
                oldStartPart = oldParts[++oldStartIndex];
                newStartResult = newResults[++newStartIndex];
            }
            else if (oldEndPart.key == newEndResult.key) {
                // Old tail matches new tail; update in place
                log(`> Tails match ${oldEndIndex}`);
                newParts[newEndIndex] = updatePart(oldEndPart, newEndResult);
                oldEndPart = oldParts[--oldEndIndex];
                newEndResult = newResults[--newEndIndex];
            }
            else if (oldStartPart.key == newEndResult.key) {
                // Old head matches new tail; update and move to new tail
                log(`> Swap ${oldStartIndex}`);
                newParts[newEndIndex] = updatePart(oldStartPart, newEndResult);
                movePart(directivePart, oldStartPart, newParts[newEndIndex + 1]);
                oldStartPart = oldParts[++oldStartIndex];
                newEndResult = newResults[--newEndIndex];
            }
            else if (oldEndPart.key == newStartResult.key) {
                // Old tail matches new head; update and move to new head
                log(`> Swap ${oldEndIndex}`);
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
                    log(`> Removing unused items`);
                    if (removeUnusedOldParts(oldParts, oldPartKeyToIndexMap, newResults, newStartIndex, newEndIndex, pool)) {
                        oldStartPart = oldParts[oldEndIndex];
                        oldEndPart = oldParts[oldStartIndex];
                        continue;
                    }
                }
                else
                    do {
                        // Walk backwards through new results (to make inserting easier) and
                        // check if we have an oldPart for this new result
                        const oldIndex = oldPartKeyToIndexMap.get(newEndResult.key);
                        const oldPart = oldIndex !== undefined ? oldParts[oldIndex] : null;
                        if (oldPart == null) {
                            // No old part for this result; create a new one and insert it
                            log(`> New item`);
                            newParts[newEndIndex] = createPart(directivePart, newEndResult, newParts[newEndIndex + 1], pool, options.reuse);
                        }
                        else {
                            // Reuse old part
                            newParts[newEndIndex] = updatePart(oldPart, newEndResult);
                            // Lazily generate longest incrementing subsequnce of new items; we'll
                            // avoid moving these to minimize the number of moves
                            if (oldIndexLIS == undefined && options.lis) {
                                oldIndexLIS = createOldIndexLIS(oldPartKeyToIndexMap, newResults, newStartIndex, newEndIndex);
                            }
                            // Move into new spot unless part is in LIS
                            if (!oldIndexLIS || !oldIndexLIS.has(oldIndex)) {
                                movePart(directivePart, oldPart, newParts[newEndIndex + 1]);
                                log(`> Move ${oldIndex}`);
                            }
                            else {
                                log(`> LIS update ${oldIndex}`);
                            }
                            // This marks the old part as having been used, so that it will be 
                            // skipped im the first two checks above
                            oldParts[oldIndex] = null;
                        }
                        newEndResult = newResults[--newEndIndex];
                    } while (oldIndexLIS && newStartIndex < newEndIndex);
            }
        }
        // Add parts for remaining results
        while (newStartIndex <= newEndIndex) {
            log(`> New item`);
            newParts[newStartIndex] = createPart(directivePart, newStartResult, oldStartPart, pool, options.reuse);
            newStartResult = newResults[++newStartIndex];
        }
        // Remove any unused old parts
        if (!oldPartKeyToIndexMap) {
            while (oldStartIndex <= oldEndIndex) {
                if (oldStartPart !== null) {
                    log(`> Remove ${oldStartIndex}`);
                    removeOrPoolPart(oldStartPart, pool);
                    oldStartPart = oldParts[++oldStartIndex];
                }
            }
        }
        // Disconnect any pooled nodes
        if (pool) {
            for (let [, part] of pool) {
                poolPartNodes(part);
            }
        }
        // Save order of new parts for next round
        partListCache.set(directivePart, newParts);
    });
}
//# sourceMappingURL=repeatFancy.js.map