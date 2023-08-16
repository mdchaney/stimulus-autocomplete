import { Controller } from "@hotwired/stimulus"

const optionSelector = "[role='option']:not([aria-disabled])"
const activeSelector = "[aria-selected='true']"

// This class will create objects that can fetch from a remote
// source and cache the results.  The initializer will accept
// a url and a queryParam.
// The cache will be keyed by the query string.  It's possible
// to use a longer key for cache lookup.  For instance, if the
// query is "johnny" and "john" is already cached and marked as
// partial: false, then we can use the cached value for "john"
// when fetching "johnny".  This is useful for autocompletes
// that fetch from a large data set.
// The cache will be an object with the following structure:
// {
//  "john": {
//  partial: false,
//  items: [ 'john', 'johnny', 'johnny appleseed', 'john doe' ],
//  exact_items: [ 'john' ],
//  field: 'name',
//  raw_term: 'John',
//  term: 'john'
//  }
//  }
class AutocompleteCache {
  constructor(url, queryParam) {
    this.url = new URL(url, window.location.origin)
    this.queryParam = queryParam
    this.cache = {}
    this.abortController = null
  }

  // Abort the last request if it's still pending
  abortLastRequest() {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
  }

  // Note that this actually updates this.url as a side effect.
  // Since it's not used anywhere else I don't care.
  buildURL(query) {
    this.url.searchParams.set(this.queryParam, query)
    return this.url.toString()
  }

  findInCache(query) {
    query = query.toLowerCase()
    if (this.cache[query]) {
      return this.cache[query]
    } else {
      for (var k of Object.keys(this.cache)) {
	if (!this.cache[k].partial && query.startsWith(k)) {
	  return this.cache[k];
	}
      }
    }
    return null
  }

  addToCache(query, data) {
    this.cache[query.toLowerCase()] = data
  }

  // Fetch will return a promise that resolves to the results
  // of the query.  If the query is already cached, then the
  // promise will resolve immediately.  Otherwise, it will
  // fetch from the remote source and cache the results.
  fetch(query) {
    const cached = this.findInCache(query)
    if (cached) return Promise.resolve(cached)

    // Otherwise, we need to fetch from the remote source
    return this.performFetch(query)
  }

  performFetch(query) {
    this.abortLastRequest()
    this.abortController = new AbortController()

    return fetch(this.buildURL(query), { signal: this.abortController.signal })
      .then((response) => {
	if (response.ok) {
	  return response.json()
	} else {
	  throw new Error(response.statusText)
	}
      })
      .then((data) => {
	this.abortController = null
	this.addToCache(query, data)
        return data
      })
  }
}

export default class Autocomplete extends Controller {
  static targets = ["input", "results"]
  static classes = ["selected"]
  static values = {
    ready: Boolean,
    submitOnEnter: Boolean,
    url: String,
    minLength: Number,
    delay: { type: Number, default: 300 },
    queryParam: { type: String, default: "q" },
  }
  static uniqOptionId = 0

  autocomplete_cache = null
  item_count = 0

  connect() {
    this.close()

    this.autocomplete_cache = new AutocompleteCache(this.urlValue, this.queryParamValue)

    if(!this.inputTarget.hasAttribute("autocomplete")) this.inputTarget.setAttribute("autocomplete", "off")
    this.inputTarget.setAttribute("spellcheck", "false")

    this.mouseDown = false

    this.onInputChange = debounce(this.onInputChange, this.delayValue)

    this.inputTarget.addEventListener("keydown", this.onKeydown)
    this.inputTarget.addEventListener("blur", this.onInputBlur)
    this.inputTarget.addEventListener("input", this.onInputChange)
    this.resultsTarget.addEventListener("mousedown", this.onResultsMouseDown)
    this.resultsTarget.addEventListener("click", this.onResultsClick)

    if (this.inputTarget.hasAttribute("autofocus")) {
      this.inputTarget.focus()
    }

    this.readyValue = true
  }

  disconnect() {
    if (this.hasInputTarget) {
      this.inputTarget.removeEventListener("keydown", this.onKeydown)
      this.inputTarget.removeEventListener("blur", this.onInputBlur)
      this.inputTarget.removeEventListener("input", this.onInputChange)
    }

    if (this.hasResultsTarget) {
      this.resultsTarget.removeEventListener("mousedown", this.onResultsMouseDown)
      this.resultsTarget.removeEventListener("click", this.onResultsClick)
    }
  }

  sibling(next) {
    const options = this.options
    const selected = this.selectedOption
    const index = options.indexOf(selected)
    const sibling = next ? options[index + 1] : options[index - 1]
    const def = next ? options[0] : options[options.length - 1]
    return sibling || def
  }

  select(target) {
    const previouslySelected = this.selectedOption
    if (previouslySelected) {
      previouslySelected.removeAttribute("aria-selected")
      previouslySelected.classList.remove(...this.selectedClassesOrDefault)
    }

    if (this.item_count > 0 && !target.classList.contains("disabled")) {
      target.setAttribute("aria-selected", "true")
      target.classList.add(...this.selectedClassesOrDefault)
      this.inputTarget.setAttribute("aria-activedescendant", target.id)
      target.scrollIntoView({ behavior: "auto", block: "nearest" })
    }
  }

  onKeydown = (event) => {
    const handler = this[`on${event.key}Keydown`]
    if (handler) handler(event)
  }

  onEscapeKeydown = (event) => {
    if (!this.resultsShown) return

    this.hideAndRemoveOptions()
    event.stopPropagation()
    event.preventDefault()
  }

  onArrowDownKeydown = (event) => {
    const item = this.sibling(true)
    if (item) this.select(item)
    event.preventDefault()
  }

  onArrowUpKeydown = (event) => {
    const item = this.sibling(false)
    if (item) this.select(item)
    event.preventDefault()
  }

  onTabKeydown = (event) => {
    const selected = this.selectedOption
    if (selected) this.commit(selected)
  }

  onEnterKeydown = (event) => {
    const selected = this.selectedOption
    if (selected && this.resultsShown) {
      this.commit(selected)
      if (!this.hasSubmitOnEnterValue) {
        event.preventDefault()
      }
    }
  }

  onInputBlur = () => {
    if (this.mouseDown) return
    this.close()
  }

  commit(selected) {
    if (selected.ariaDisabled) return

    const textValue = selected.dataset.autocompleteValue || selected.textContent.trim()
    this.inputTarget.value = textValue

    this.inputTarget.focus()
    this.hideAndRemoveOptions()

    this.element.dispatchEvent(
      new CustomEvent("autocomplete.change", {
        bubbles: true,
        detail: { textValue: textValue, selected: selected }
      })
    )
  }

  clear() {
    this.inputTarget.value = ""
    if (this.hasHiddenTarget) this.hiddenTarget.value = ""
  }

  onResultsClick = (event) => {
    if (!(event.target instanceof Element)) return
    const selected = event.target.closest(optionSelector)
    if (selected) this.commit(selected)
  }

  onResultsMouseDown = () => {
    this.mouseDown = true
    this.resultsTarget.addEventListener("mouseup", () => {
      this.mouseDown = false
    }, { once: true })
  }

  onInputChange = () => {
    const query = this.inputTarget.value.trim()
    if (query && query.length >= this.minLengthValue) {
      this.fetchResults(query)
    } else {
      this.hideAndRemoveOptions()
    }
  }

  identifyOptions() {
    const prefix = this.resultsTarget.id || "stimulus-autocomplete"
    const optionsWithoutId = this.resultsTarget.querySelectorAll(`${optionSelector}:not([id])`)
    optionsWithoutId.forEach(el => el.id = `${prefix}-option-${Autocomplete.uniqOptionId++}`)
  }

  fetchResults = async (query) => {
    if (!this.hasUrlValue) return

    try {
      this.element.dispatchEvent(new CustomEvent("loadstart"))
      const json_response = await this.autocomplete_cache.fetch(query);
      this.replaceResults(json_response, query)
      this.element.dispatchEvent(new CustomEvent("load"))
      this.element.dispatchEvent(new CustomEvent("loadend"))
    } catch(error) {
      this.element.dispatchEvent(new CustomEvent("error"))
      this.element.dispatchEvent(new CustomEvent("loadend"))
      throw error
    }
  }

  hideAndRemoveOptions() {
    this.close()
    this.clearOptions()
  }

  clearOptions() {
    while (this.resultsTarget.firstChild) {
      this.resultsTarget.removeChild(this.resultsTarget.firstChild)
    }
  }

  // We will create a series of <li> elements, each of which will have
  // a data-autocomplete-value attribute.  Additionally, I'll add a
  // class of "list-group-item" (which should be a param or something)
  // as well as "role="option".
  //
  // Note that "json_response" is a hash with keys:
  // "items" is a list of all matching items
  // "exact_items" is a list of items that exactly match the query
  // "field" is the name of the field that was searched
  // "raw_term" is the term that was searched for
  // "term" is the term that was searched for, but with any special characters
  //  escaped
  //  "partial" is a boolean indicating whether the search was partial
  replaceResults(json_response, query) {
    const all_items = this.getUniqueItemList(json_response)
    this.updateResults(all_items, query)

    this.identifyOptions()
    if (!!this.options) {
      this.open()
      this.setHeight()
    } else {
      this.close()
    }
  }

  // updateResults will take a list of all items and update the DOM
  // to reflect the new list of items.
  updateResults(items, query) {
    this.item_count = 0
    let last_li = null
    const existing_lis = this.options
    const lower_query = query.toLowerCase()
    let shown_items = [];
    for (var item of items) {
      const pos = item.toLowerCase().indexOf(lower_query);
      if (pos >= 0) {
        const prefix = item.slice(0, pos)
        const match = item.slice(pos, pos + query.length)
        const suffix = item.slice(pos + query.length)
        const prefix_txt = document.createTextNode(prefix)
        const match_txt = document.createTextNode(match)
        const match_em = document.createElement("em")
        match_em.appendChild(match_txt)
        const suffix_txt = document.createTextNode(suffix)
        const existing_li = existing_lis.find(li => li.dataset.autocompleteValue === item)
        if (existing_li) {
          last_li = existing_li
          while (existing_li.firstChild) {
            existing_li.removeChild(existing_li.firstChild)
          }
          existing_li.appendChild(prefix_txt)
          existing_li.appendChild(match_em)
          existing_li.appendChild(suffix_txt)
        } else {
          const li = document.createElement("li")
          li.classList.add("list-group-item")
          li.dataset.autocompleteValue = item
          li.setAttribute("role", "option")
          li.appendChild(prefix_txt)
          li.appendChild(match_em)
          li.appendChild(suffix_txt)
          if (last_li) {
            this.resultsTarget.insertBefore(li, last_li.nextSibling)
          } else {
            this.resultsTarget.insertBefore(li, this.resultsTarget.firstChild)
          }
          last_li = li
        }
        this.item_count += 1
        shown_items.push(item)
      }
    }

    // Remove any <li> elements that are no longer needed.
    for (var li of existing_lis) {
      if (!shown_items.includes(li.dataset.autocompleteValue)) {
        this.resultsTarget.removeChild(li)
      }
    }

    // If there are no items, then we should hide the results.
    if (this.item_count === 0) {
      this.showSorryMessage(query)
    } else {
      this.hideSorryMessage()
    }
  }

  // If there are no results, then we should show a "sorry" message.
  // The sorry message will be shown as an li with a class of
  // "list-group-item" and a class of "disabled".
  // Note that when the sorry message is shown the other list items
  // have already been removed.
  showSorryMessage(query) {
    this.hideSorryMessage()
    const li = document.createElement("li")
    li.classList.add("list-group-item", "disabled", "sorry-message")
    li.ariaDisabled = true
    li.appendChild(document.createTextNode(`No results found for "${query}"`))
    this.resultsTarget.appendChild(li)
    this.setHeight()
  }

  hideSorryMessage() {
    const li = this.resultsTarget.querySelector("li.sorry-message")
    if (li) this.resultsTarget.removeChild(li)
  }

  // setHeight will set the height of the resultsTarget to be the
  // height of the first item times the number of items.
  // If there are 5 or fewer items, then the height will be cleared
  // so that the resultsTarget will be as tall as it needs to be.
  // If there are more than 5 items, we will set the height of the
  // resultsTarget to be the height of the first item times five.
  setHeight() {
    const li = this.resultsTarget.querySelector("li")
    if (li) {
      const li_height = li.offsetHeight
      if (this.item_count <= 5) {
        this.resultsTarget.style.height = ""
      } else {
        this.resultsTarget.style.height = `${li_height * 5}px`
      }
    }
  }

  // The unique item list will have the exact matches first, followed by
  // the partial matches.
  getUniqueItemList(json_response) {
    const exact_items = json_response.exact_items
    const partial_items = json_response.items.filter(item => !exact_items.includes(item))
    return exact_items.concat(partial_items)
  }

  open() {
    if (this.resultsShown) return

    this.resultsShown = true
    this.element.setAttribute("aria-expanded", "true")
    this.element.dispatchEvent(
      new CustomEvent("toggle", {
        detail: { action: "open", inputTarget: this.inputTarget, resultsTarget: this.resultsTarget }
      })
    )
  }

  close() {
    if (!this.resultsShown) return

    this.resultsShown = false
    this.inputTarget.removeAttribute("aria-activedescendant")
    this.element.setAttribute("aria-expanded", "false")
    this.element.dispatchEvent(
      new CustomEvent("toggle", {
        detail: { action: "close", inputTarget: this.inputTarget, resultsTarget: this.resultsTarget }
      })
    )
  }

  get resultsShown() {
    return !this.resultsTarget.hidden
  }

  set resultsShown(value) {
    this.resultsTarget.hidden = !value
  }

  get options() {
    return Array.from(this.resultsTarget.querySelectorAll(optionSelector))
  }

  get selectedOption() {
    return this.resultsTarget.querySelector(activeSelector)
  }

  get selectedClassesOrDefault() {
    return this.hasSelectedClass ? this.selectedClasses : ["active"]
  }

  optionsForFetch() {
    return { headers: { "X-Requested-With": "XMLHttpRequest" } } // override if you need
  }
}

const debounce = (fn, delay = 10) => {
  let timeoutId = null

  return (...args) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(fn, delay)
  }
}

export { Autocomplete }
