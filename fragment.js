const puppeteer = require('puppeteer-extra');
const stealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(stealthPlugin());
const fs = require('fs/promises');

//discord.js
const { Client, GatewayIntentBits, EmbedBuilder} = require('discord.js');
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.login(process.env.DISCORD_BOT_TOKEN);
let logChannel;
let mainChannel;
client.on('ready', async () => {
    try {
        console.log('going')
        mainChannel = client.channels.cache.get('1224520138896838751');
        if(mainChannel == null){
            mainChannel = await client.channels.fetch('1224520138896838751');
        }

        logChannel = client.channels.cache.get('1224520268463079464');
        if(logChannel == null){
            logChannel = await client.channels.fetch('1224520268463079464');
        }
    } catch (error) {
        await logChannel.send('Error fetching channel: ' + error);
    }

    //Start up
    await start();
});

//Database connection
const { MongoClient, ServerApiVersion } = require('mongodb');
const uri = "mongodb+srv://SpatulaSoftware:jpTANtS4n59oqlam@spatula-software.tyas5mn.mongodb.net/?retryWrites=true&w=majority";
const mongoClient = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});
let staticProxyDB;
(async () => {
    try {
        await mongoClient.connect();
        await mongoClient.db("admin").command({ ping: 1 });
        console.log("online");
        staticProxyDB = mongoClient.db('Spatula-Software').collection('staticProxies');
    } catch(error){
        await mongoClient.close();
        console.log("Mongo Connection " + error);
    }
})();

// Add cleanup logic on uncaught exception
process.on('uncaughtException', async (err) => {
    await logChannel.send('Uncaught Exception in ' + workerData.name + ': ' + err);
});

// Add cleanup logic on unhandled promise rejection
process.on('unhandledRejection', async (reason, promise) => {
    await logChannel.send('Unhandled Rejection in ' + workerData.name + ':' + reason);
});

const endTask = async () => {
    try {
        await logChannel.send("Close Browsers");
        if(mainBrowser != null){
            await mainPage.close();
            await mainBrowser.close();
            mainBrowser = null;
        }
        parentPort.postMessage("Success");
    } catch (error) {
        await logChannel.send("Error closing browser: " + error);
    }
}

//randomize time till post check
const getRandomInterval = () => {
    try {
        const minNumber = 240000; //2 mins
        const maxNumber = 900000; //5 mins
        const power = 1.5;
        const random = Math.random();
        const range = maxNumber - minNumber;
        const number = minNumber + Math.pow(random, power) * range;
        return Math.round(number);
    } catch (error) {
        logChannel.send('error getting random interval' + error);
    }
}

//send content of the page to discord
const logPageContent = async (page) => {
    try{
        //html
        const htmlContent = await page.content();
        const { Readable } = require('stream');
        const htmlStream = Readable.from([htmlContent]);
        await logChannel.send({
            files: [
                {
                    attachment: htmlStream,
                    name: 'website.html',
                },
            ],
        });

        //png
        await page.screenshot({ path: 'screenshot.png' });
        await logChannel.send({
            files: ['screenshot.png'],
        });
        await fs.unlink('screenshot.png');
    }catch(error){
        await logChannel.send('error login content: ' + error);
    }
}

let platforms = ['Macintosh; Intel Mac OS X 10_15_7', 'X11; Linux x86_64', 'Windows NT 10.0; Win64; x64']
let startError = false; //stops script on error
let mainBrowser;
let mainPage;
let listingStorage;
let isInitiate = true;

const start = async () => {
    try{

        //get a random proxy
        const randomProxyObj = await staticProxyDB.aggregate([{ $sample: { size: 1 } }]).toArray();

        //initialize the static isp proxy page
        mainBrowser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', `--proxy-server=${randomProxyObj[0].Proxy}`],
            timeout: 60000
        });
        let pages = await mainBrowser.pages();
        mainPage = pages[0];

        //change the viewport
        mainPage.setViewport({ width: 1366, height: 768 });

        //change http headers
        let UAPlatform = platforms[Math.floor(Math.random() * 2)];
        mainPage.setUserAgent(`Mozilla/5.0 (${UAPlatform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36`);
        mainPage.setExtraHTTPHeaders({
            'Sec-Ch-Ua': 'Not.A/Brand";v="8", "Chromium";v="121", "Google Chrome";v="121',
            'SEC-CH-UA-ARCH': '"x86"',
            'Sec-Ch-Ua-Full-Version': "121.0.6167.185",
            'SEC-CH-UA-MOBILE':	'?0',
            'Sec-Ch-Ua-Platform': `"${UAPlatform}"`,
            'SEC-CH-UA-PLATFORM-VERSION': '15.0.0',
            'Referer': 'https://www.google.com'
        });

        //network shit
        mainPage.on('response', async response => {
            try {
                //detect redirection
                if ([300, 301, 302, 303, 307, 308].includes(response.status())) {
                    const redirectURL = response.headers()['location'];
                    if(await redirectURL.split('?')[0] != (workerData.link).split('?')[0]){
                        console.log(`Redirected to: ${redirectURL}`);
                        logChannel.send(`${workerData.name} redirected to: ${redirectURL}`);
                        startError = true; 
                    }
                }
            }catch (error) {
                await logChannel.send("Error with handling network response" + error);
            }
        });

        await mainPage.setRequestInterception(true);
        mainPage.on('request', async request => {
            const resource = request.resourceType();
            if(resource != 'document' && resource != 'script' && resource != 'xhr' && resource != 'fetch' && resource != 'other'){
                request.abort();
            }else{
                request.continue();
            }
        });

        //go to the search page
        try {
            await mainPage.goto('https://fragment.com/?sort=listed&filter=sale', { waitUntil: 'domcontentloaded', timeout: 50000});
        } catch (error) {await logChannel.send("Timeout on going to link")}

        
        listingStorage = await getListings(1);
        console.log("Main Storage: " + listingStorage);
        if(isInitiate){
            interval();
            isInitiate = false;
        }
    }catch(error){
        await logPageContent(mainPage);
        await logChannel.send('error with start' + error);
    }
}

const getListings = async (num) => {
    try{
        if(startError == false){
            return await mainPage.evaluate(() => {
                return document.querySelector(`#aj_content > main > section.tm-section.clearfix.js-search-results > div.tm-table-wrap > table > tbody > tr:nth-child(${num}) > td.wide-last-col.wide-only > a`).href
            }, num)
        }
    }catch (error){
        await logChannel.send('Error with setting listing storage' + error);
    }
}

//the meat and cheese
function interval() {
    setTimeout(async () => {
        let postNum = 1;

        //start up a new page with fresh proxy and get listings
        await mainPage.reload({ waitUntil: 'load', timeout: 50000});
        let currentListing = await getListings(1);
        console.log("Current Listing: " + currentListing);

        //newPost is actually new
        while(currentListing != listingStorage){
            console.log("New Post: " + currentListing);

            let data = await mainPage.evaluate((postNum) => {
                const container = document.querySelector(`#aj_content > main > section.tm-section.clearfix.js-search-results > div.tm-table-wrap > table > tbody > tr:nth-child(${postNum})`)
                return {
                    name: container.querySelector(`a > div.table-cell-value-row`).innerText,
                    price: container.querySelector(`td.thin-last-col > a > div.table-cell-value.tm-value.icon-before.icon-ton`).innerText,
                    auctionEnd: container.querySelector('div.tm-timer').innerText,
                }
            }, postNum)
            
            //check for listing deleted and collection error
            try{
                mainChannel.send({ content: data.name + " - $" + data.price, embeds: [new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle(data.name + " - $" + data.price)
                    .setURL('https://fragment.com' + currentListing)
                    .setDescription('End date: ' + data.auctionEnd)
                    .setTimestamp(new Date())
                ]});
            }catch(error){
                await logChannel.send('Error with item notification' + error);
            }

            postNum++;
            currentListing = await getListings(postNum);
        }
        
        listingStorage = await getListings(1);
        interval();
    }, getRandomInterval());
} 