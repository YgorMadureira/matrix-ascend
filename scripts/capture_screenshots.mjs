import puppeteer from 'puppeteer';
import path from 'path';

const BRAIN = 'C:\\Users\\SPXBR38903\\.gemini\\antigravity\\brain\\da637c84-d029-4a63-a983-fe93d2312b58';
const BASE = 'http://localhost:8080';

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1920, height: 1080 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  
  // Increase global timeout
  page.setDefaultNavigationTimeout(60000);
  page.setDefaultTimeout(60000);

  // 1. Login
  console.log('Logging in...');
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="email"]', { visible: true });
  await page.type('input[type="email"]', 'pts.spx@shopee.com');
  await page.type('input[type="password"]', 'admin123');
  await page.click('button[type="submit"]');
  
  // Wait for redirect to dashboard
  await new Promise(r => setTimeout(r, 5000));
  console.log('Logged in!');

  // Helper function for navigating and capturing
  const capture = async (url, filename, isTab = false) => {
      console.log(`Capturing ${filename}...`);
      if (!isTab) {
          await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' });
      }
      await new Promise(r => setTimeout(r, 5000)); // wait for data to load
      await page.screenshot({ path: path.join(BRAIN, filename), fullPage: false });
  };

  await capture('/dashboard', 'real_dashboard.png');
  await capture('/collaborators', 'real_collaborators.png');
  await capture('/reports', 'real_reports.png');
  await capture('/schedule', 'real_schedule_calendar.png');

  // Screenshot: Schedule - Solicitacoes tab
  console.log('Capturing Schedule (Solicitacoes)...');
  try {
    const tabs = await page.$$('button');
    for (const tab of tabs) {
      const text = await page.evaluate(el => el.textContent, tab);
      if (text && text.includes('Solicitações')) {
        await tab.click();
        break;
      }
    }
    await new Promise(r => setTimeout(r, 3000));
    await page.screenshot({ path: path.join(BRAIN, 'real_schedule_requests.png'), fullPage: false });
  } catch (e) {
    console.log('Error capturing Solicitacoes tab:', e.message);
  }

  await capture('/signatures', 'real_signatures.png');
  await capture('/materials', 'real_materials.png');
  await capture('/trainings', 'real_trainings.png');
  await capture('/settings', 'real_settings.png');
  await capture('/socs', 'real_socs.png');

  await browser.close();
  console.log('All screenshots captured successfully!');
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
