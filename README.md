# Braze Catalogs Image Preview

Chrome extension that improves Braze Catalog item tables by replacing image URL values with inline thumbnails. Clicking a thumbnail opens a lightweight theater-style preview with the full image, the original URL, and a copy action.

## What It Does

- Runs only on Braze dashboard Catalog pages.
- Detects image URLs in visible Catalog table or grid cells.
- Replaces detected image URL text with compact thumbnail previews.
- Keeps the original URL available through a `data-original-url` attribute and a **Copy URL** button.
- Opens a larger image preview in a modal when a thumbnail is clicked.
- Closes the modal with Escape, outside click, or the close button.
- Handles Braze single-page-app updates with route checks and a debounced `MutationObserver`.
- Uses isolated CSS classes prefixed with `braze-catalog-image-preview`.

## Supported Image URLs

The extension supports HTTP and HTTPS image URLs whose path ends in one of:

- `.jpg`
- `.jpeg`
- `.png`
- `.gif`
- `.webp`
- `.avif`
- `.svg`

Query strings and hash fragments are supported:

```text
https://example.com/image.jpg?width=500#preview
```

## Braze URL Detection

The extension manifest injects only on:

- `https://*.braze.com/*`
- `https://*.braze.eu/*`

The content script then checks the current path and hash before doing any work. By default it activates on Catalog routes containing:

- `catalog`
- `catalogs`
- `catalog_item`
- `catalog_items`

Example supported URL:

```text
https://dashboard-02.braze.eu/dashboard/catalogs/678fad876bd9e100832553be/6703caf6ffbcdd19098a0b21?name=Sklum-Catalog-Tables-Spanish&locale=en
```

The route matcher and image URL matcher are both configured near the top of `src/contentScript.js`.

## Installation In Chrome

1. Download or clone this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this repository folder.
6. Open or refresh a Braze Catalog page.

After changing extension files locally, click the reload button for the extension in `chrome://extensions`, then refresh the Braze tab. Content scripts do not hot-reload into already-open pages.

## How To Use

1. Open a Braze Catalog page.
2. Find a table column containing image URLs, for example `productImage`.
3. Supported URLs should be replaced by thumbnails.
4. Click a thumbnail to open the larger preview.
5. Use **Copy URL** to copy the original image URL.

## Project Structure

```text
manifest.json
src/
  contentScript.js
  styles.css
```

- `manifest.json` defines the Manifest V3 extension and Braze host scope.
- `src/contentScript.js` contains Catalog route detection, URL scanning, thumbnail replacement, modal behavior, and SPA update handling.
- `src/styles.css` contains isolated Braze-inspired thumbnail and modal styling.

## Manual QA Checklist

- The extension does not run on unrelated Braze pages.
- The extension runs on `/dashboard/catalogs/...` URLs.
- Image URLs in visible Catalog table/grid cells become thumbnails.
- Image URLs with query strings still become thumbnails.
- Copy buttons preserve the original URL.
- Clicking a thumbnail opens the modal preview.
- Escape, outside click, and close button all close the modal.
- Newly rendered rows are processed after scrolling, filtering, pagination, or SPA navigation.
- Repeated updates do not duplicate thumbnails.

## Known Limitations

- URLs must include an explicit image file extension in the URL path.
- Rows that Braze has not rendered yet are processed only when they appear in the DOM.
- Images blocked by the source server, hotlink protection, authentication, or network policy may not visually load.
- Styling is Braze-inspired but does not import Braze's private design-system package.
