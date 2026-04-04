// Import Playwright for browser automation
const { firefox } = require("playwright");

// File system module so we can save the scraped data
const fs = require("fs");

// Path module so we can build the output file path safely
const path = require("path");

// Function to generate random delays
function randomDelay(min = 1200, max = 3000) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Wrap everything in an async function so we can use await
(async () => {

  // Launch Firefox
  // headless: false lets you watch it run
  const browser = await firefox.launch({ headless: true});

  // Open a new browser tab
  const page = await browser.newPage();

  try {

    // 1. Go to Yahoo Finance homepage
    await page.goto("https://finance.yahoo.com/", {waitUntil: "domcontentloaded", timeout: 30000});

    // Small pause after loading
    await page.waitForTimeout(randomDelay(2000, 4000));

    // 2. Handle cookie popup if it appears
    const acceptBtn = page.locator(
      'button:has-text("Accept"), button:has-text("I agree"), button[name="agree"]'
    );

    if (await acceptBtn.count() > 0) {
      console.log("Cookie button found. Clicking it...");
      await acceptBtn.first().click().catch(() => {});
      await page.waitForTimeout(randomDelay(800, 1800));
    }

    // 3. Targeting the "News" menu item, not just the text link
    // Using the li that contains the News link and its dropdown
    const newsLi = page.locator('nav#navigation-container li:has(a[href="https://finance.yahoo.com/news/"])').first();

    console.log("Waiting for News menu item...");
    await newsLi.waitFor({ state: "visible", timeout: 15000 });

    // Hovering over the whole menu item so its dropdown opens
    console.log("Hovering over News menu item...");
    await newsLi.hover();
    await page.waitForTimeout(randomDelay(1200, 2000));

    // 4. Waiting for the News dropdown to appear
    const newsDropdown = newsLi.locator("ol.dropdown");
    await newsDropdown.waitFor({ state: "visible", timeout: 10000 });
    console.log("News dropdown is visible.");

    // 5. Inside the News dropdown, finding "More Topics"
    // Hovering the parent li so the nested submenu appears
    const moreTopicsLi = newsDropdown.locator('li:has-text("More Topics")').first();

    console.log("Hovering over More Topics...");
    await moreTopicsLi.waitFor({ state: "visible", timeout: 10000 });
    await moreTopicsLi.hover();
    await page.waitForTimeout(randomDelay(1200, 2000));

    // 6. Waiting for the nested submenu under "More Topics"
    const moreTopicsDropdown = moreTopicsLi.locator("ol.dropdown, ol");
    await moreTopicsDropdown.waitFor({ state: "visible", timeout: 10000 });
    console.log("More Topics submenu is visible.");

    // 7. Finding "Economies" inside the nested submenu and clicking it
    const economiesLink = moreTopicsDropdown.locator('a:has-text("Economies")').first();

    console.log("Clicking Economies...");
    await economiesLink.waitFor({ state: "visible", timeout: 10000 });
    await economiesLink.click();

    // 8. Waiting for the "Economies" page to load
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(randomDelay(2000, 4000));

    const currentUrl = await page.url();
    console.log("Current page after clicking Economies:", currentUrl);

    // Checking to if know it really navigated away
    if (!currentUrl.toLowerCase().includes("economic")) {
      console.log("Warning: URL does not clearly show economic-news. Continuing anyway.");
    }

    // 9. Waiting until links exist on the page
    await page.waitForSelector("a", { timeout: 15000 });

    // 10. Collecting articles from top + scroll until we reach 10
    const links = await page.evaluate(async () => {
    
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    
      const seen = new Set();
      const results = [];
    
      // Function to extracting links from current page view
      const collectLinks = () => {
        const anchors = document.querySelectorAll("a[href]");
    
        for (const el of anchors) {
          const url = el.href || "";
          const lowerUrl = url.toLowerCase();
          let title = (el.innerText || el.textContent || "").trim();
    
          if (!title || !url) continue;
          if (seen.has(url)) continue;
    
          if (!lowerUrl.includes("/news/")) continue;
    
          if (
            lowerUrl.includes("/video") ||
            lowerUrl.includes("/live") ||
            lowerUrl.includes("/quote") ||
            lowerUrl.includes("/topic") ||
            lowerUrl.includes("watchlist") ||
            lowerUrl.includes("portfolio")
          ) {
            continue;
          }
    
          // Filter junk labels
          if (title.length < 25) continue;
          if (
            title === "Yahoo Finance" ||
            title === "Bloomberg" ||
            title === "CNN Business" ||
            title === "Motley Fool" ||
            title === "Fortune"
          ) {
            continue;
          }
    
          seen.add(url);
          results.push({ title, url });
    
          if (results.length === 10) break;
        }
      };
    
      // 1. Collecting from the tOP first
      collectLinks();
    
      // 2. Keep scrolling and collecting until we reach 10
      let scrollAttempts = 0;
    
      while (results.length < 10 && scrollAttempts < 5) {
        window.scrollBy(0, 1200);
        await sleep(1500);
    
        collectLinks();
    
        scrollAttempts++;
      }
    
      return results;
    });
    
    console.log("Number of links collected:", links.length);
    console.log(links);

    // Stopping if no links were found
    if (links.length === 0) {
      throw new Error("No article links were found on the Economies page.");
    }

    // 11. Visiting each article and scraping its text
    const scrapedArticles = [];

    for (let i = 0; i < links.length; i++) {
      const article = links[i];
      const articlePage = await browser.newPage();

      try {
        console.log(`Scraping article ${i + 1}: ${article.title}`);

        // Small random pause before opening article
        await page.waitForTimeout(randomDelay(1000, 2500));

        // Opening article page
        await articlePage.goto(article.url, {
          waitUntil: "domcontentloaded",
          timeout: 30000
        });

        // Waiting for text to finish rendering
        await articlePage.waitForTimeout(randomDelay(2500, 5000));

        // 12. Grabbing article title
        let articleTitle = "";
        const h1Locator = articlePage.locator("h1").first();

        if (await h1Locator.count() > 0) {
          articleTitle = (await h1Locator.textContent())?.trim() || "";
        }

        // Fallback if h1 was missing
        if (!articleTitle) {
          articleTitle = article.title;
        }

        // 13. Trying several selectors for article paragraphs
        let paragraphsTexts = [];

        const possibleSelectors = [
          "article p",
          '[data-testid="article-content-wrapper"] p',
          '[data-test-locator="article"] p',
          "main p",
          "p"
        ];

        for (const selector of possibleSelectors) {
          const loc = articlePage.locator(selector);
          const count = await loc.count();

          if (count > 5) {
            paragraphsTexts = await loc.allTextContents();
            break;
          }
        }

        // 14. Cleaning text
        paragraphsTexts = paragraphsTexts
          .map((p) => p.trim())
          .filter((p) =>
            p.length > 40 &&
            !p.includes("Advertisement") &&
            !p.includes("Recommended Stories") &&
            !p.includes("Sign in") &&
            !p.includes("Terms and Privacy Policy")
          );

        const articleText = paragraphsTexts.join("\n\n");

        if (!articleText) {
          throw new Error("No article body text found.");
        }

        // Saving successful article scrape
        scrapedArticles.push({
          article_num: i + 1,
          title: articleTitle,
          url: article.url,
          text: articleText
        });

      } catch (err) {

        // Saving error info for failed article
        scrapedArticles.push({
          article_num: i + 1,
          title: article.title,
          url: article.url,
          text: "",
          error: err.message
        });

      } finally {

        // Closing the article tab
        await articlePage.close();
      }
    }

    // 15. Saving scraped data to JSON in the same folder as this JS file
    const outputPath = path.join(__dirname, "articles_market.json");

    console.log("About to save file...");
    console.log("Saving to:", outputPath);

    fs.writeFileSync(
      outputPath,
      JSON.stringify(scrapedArticles, null, 2),
      "utf-8"
    );

    console.log(`Saved ${scrapedArticles.length} articles to ${outputPath}`);

  } catch (err) {

    // Printing any script-level error
    console.error("Script failed:", err);

  } finally {

    // Closing the browser
    await browser.close();
  }

})(); // Immediately run the async function