// Import the Playwright library for browser automation
const {firefox} = require("playwright");

// Importing FireFox
const fs = require("fs");

const path = require("path");

// Wrap the script in an async function so we can use await  for asynchronous tasks
(async () => {
  const ticker = "TSLA"; // Defining the ticker
  
  // Launch a headless browser (runs without showing a window). We can use FALSE to watch the window
  const browser = await firefox.launch({headless: true});
  
  // Create a new page (browser tab)
  const page = await browser.newPage();
  
  try{
    // Navigate to the Yahoo Finance and then wait until the network is idle - meaning all requests, like JS tables, are done loading
    await page.goto("https://ca.finance.yahoo.com/", {waitUntil: "domcontentloaded"});
  
    // Handle cookie popup if it appears
    const acceptBtn = page.locator('button:has-text("Accept"), button:has-text("I agree")');
    
    if (await acceptBtn.count() > 0){
      await acceptBtn.first().click().catch(() => {});
    }
    
    
    // 1. Clicking the search bar, type TSLA, and press ENTER
    const searchBar = page.locator('input[placeholder*="Search"]');
    await searchBar.waitFor({ state: "visible", timeout: 10000});
    await searchBar.fill(ticker);
    await searchBar.press("Enter");

    // Waiting for TSLA page to load
    const newsMenuLink = page.locator(`a[href="/quote/${ticker}/news/"]`).first();
    await newsMenuLink.waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(1500);
    
    
    // 2. Clicking on "News" in the left menu under "Summary"
    await newsMenuLink.scrollIntoViewIfNeeded();
    await newsMenuLink.click();
    
    // Wait for the news page to load
    await page.waitForTimeout(3000);
    await page.waitForSelector('main a[href*="/news/"]', { timeout: 15000 });
    
    // Collecting the first 6 article links
    const links = await page.locator('main a[href*="/news/"]').evaluateAll((elements) => {
      const seen = new Set();
      const results = [];
    
      for (const el of elements) {
        const title = (el.innerText || "").trim();
        const url = el.href;
    
        if (!title || !url) continue;
        if (seen.has(url)) continue;
    
        const containerText = (el.parentElement?.innerText || "").trim();
    
        // Skip ads
        if (containerText.includes("Ad")) continue;
    
        // Skip obvious non-article news hub links
        if (url.includes("/topic/news/")) continue;
    
        // Skip very short junk titles
        if (title.length < 20) continue;
    
        seen.add(url);
        results.push({ title, url, meta: containerText });
    
        if (results.length === 6) break;
      }
    
      return results;
    });
    
    console.log("Collected article links:");
    console.log(links);
    
    
    if (links.length === 0){
      throw new Error("No article links were found.");
    }
    
    const scrapedArticles = [];
    
    // Visiting each article one by one
    for (let i = 0; i < links.length; i++){
      const article = links[i];
      const articlePage = await browser.newPage();
      
      try{
        console.log(`Scraping article ${i + 1}: ${article.title}`);
        await articlePage.goto(article.url, {waitUntil: "domcontentloaded", timeout: 30000});
        
        await articlePage.waitForTimeout(4000);
        
        let articleTitle = "";
        const h1Locator = articlePage.locator("h1").first();
        
        if (await h1Locator.count() > 0){
          articleTitle = (await h1Locator.textContent())?.trim() || "";
        }
        
        if (!articleTitle){
          articleTitle = article.title;
        }
        
        // Grabbing paragraphs
        let paragraphsTexts = [];
        
        const possibleSelectors = [
          "article p",
          "[data-test-locator='articleBody'] p",
          "main p",
          "section p",
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
        
        // Cleaning paragraph text
        paragraphsTexts = paragraphsTexts
          .map((p) => p.trim())
          .filter((p) => p.length > 40);
        
        const articleText = paragraphsTexts.join("\n\n");
        
        if (!articleText) {
          throw new Error("No article body text found.");
        }
        
        scrapedArticles.push({
          ticker: ticker,
          article_num: i + 1,
          title: articleTitle,
          url: article.url,
          text: articleText
        });
      } catch (err){
        scrapedArticles.push({
          ticker: ticker,
          article_num: i + 1,
          title: article.title,
          url: article.url,
          text: "",
          error: err.message
        });
      } finally{
        await articlePage.close();
      }
    }
    
    const outputPath = path.join(__dirname, `articles_${ticker}.json`);

    fs.writeFileSync(outputPath, JSON.stringify(scrapedArticles, null, 2), "utf-8");
    
    console.log(`Saved ${scrapedArticles.length} articles to ${outputPath}`);
  } catch (err){
    console.error("Script failed:", err);
  } finally{
    // Closing the browser
    await browser.close();
  }
})(); // Immediately invoke the async function