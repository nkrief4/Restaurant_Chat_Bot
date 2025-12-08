/**
 * Iterates over a NodeList or Array and executes a handler for each element.
 * @param {NodeList|Array} list - The list of elements to iterate over.
 * @param {Function} handler - The function to execute for each element.
 */
export function forEachNode(list, handler) {
    if (!list || typeof handler !== "function") {
        return;
    }
    for (let index = 0; index < list.length; index += 1) {
        handler(list[index], index);
    }
}
