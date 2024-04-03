require('dotenv').config();
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
let privateListingsChannel;
client.on('ready', async () => {
    try {
        mainChannel = client.channels.cache.get('1224520138896838751');
        if(mainChannel == null){
            mainChannel = await client.channels.fetch('1224520138896838751');
        }

        logChannel = client.channels.cache.get('1224520268463079464');
        if(logChannel == null){
            logChannel = await client.channels.fetch('1224520268463079464');
        }

        privateListingsChannel = client.channels.cache.get('1224856127825645709');
        if(privateListingsChannel == null){
            privateListingsChannel = await client.channels.fetch('1224856127825645709');
        }
    } catch (error) {
        await logChannel.send('Error fetching channel: ' + error);
    }
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

        //Start up
        await start();
    } catch(error){
        await mongoClient.close();
        console.log("Mongo Connection " + error);
    }
})();

// Add cleanup logic on uncaught exception
process.on('uncaughtException', async (err) => {
    await logChannel.send('Uncaught Exception: ' + err);
});

// Add cleanup logic on unhandled promise rejection
process.on('unhandledRejection', async (reason, promise) => {
    await logChannel.send('Unhandled Rejection: ' + reason);
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
        const minNumber = 120000; //2 mins
        const maxNumber = 300000; //5 mins
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
                    if(await redirectURL != 'https://fragment.com/?sort=listed&filter=sale'){
                        console.log(`Redirected to: ${redirectURL}`);
                        logChannel.send(`Redirected to: ${redirectURL}`);
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
            if(resource != 'document'){
                request.abort();
            }else{
                request.continue();
            }
        });

        //go to the search page
        try {
            await mainPage.goto('https://fragment.com/?sort=listed&filter=sale', { waitUntil: 'domcontentloaded', timeout: 50000});
        } catch (error) {await logChannel.send("Timeout on going to link")}

        
        listingStorage = [await getListing(1), await getListing(2)];
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

const getListing = async (num) => {
    try{
        if(startError == false){
            return await mainPage.evaluate((num) => {
                return document.querySelector(`#aj_content > main > section.tm-section.clearfix.js-search-results > div.tm-table-wrap > table > tbody > tr:nth-child(${num}) > td.wide-last-col.wide-only > a`).href
            }, num)
        }
    }catch (error){
        await logPageContent(mainPage);
        await logChannel.send('Error with setting listing storage' + error);
    }
}

//the meat and cheese
function interval() {
    setTimeout(async () => {
        try {
            let postNum = 1;

            //start up a new page with fresh proxy and get listings
            await mainPage.reload({ waitUntil: 'load', timeout: 50000});
            let currentListing = await getListing(postNum);
            console.log("Current Listing: " + currentListing);

            //newPost is actually new
            while(currentListing != listingStorage[0] && currentListing != listingStorage[1] && currentListing != null){
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
                    await mainChannel.send({embeds: [new EmbedBuilder()
                        .setColor(0x0099FF)
                        .setTitle(data.name + " - " + data.price + " TON")
                        .setURL(currentListing)
                        .setDescription(data.auctionEnd)
                        .setTimestamp(new Date())
                    ]});
                }catch(error){
                    await logChannel.send('Error with item notification' + error);
                }

                //private listing channel notification
                if(parseFloat((data?.price)?.replace(/[^\d.]/g, '')) < 5){
                    try{
                        await privateListingsChannel.send({embeds: [new EmbedBuilder()
                            .setColor(0x0099FF)
                            .setTitle(data.name + " - " + data.price + " TON")
                            .setURL(currentListing)
                            .setDescription(data.auctionEnd)
                            .setTimestamp(new Date())
                        ]});
                    }catch(error){
                        await logChannel.send('Error with item notification' + error);
                    }
                }

                //**Look at how listing a name works. Maybe we can leave something like this in
                
                //**Also figure out what is causing the spam. That might not be the best way to solve it, the double listing storage might have already*/
                /*if((data?.auctionEnd).includes("23")){
                    postNum++;
                    currentListing = await getListing(postNum);
                }else{
                    currentListing = null;
                    await logChannel.send("Not-23 hours: " + data?.auctionEnd);
                }*/
                postNum++;
                currentListing = await getListing(postNum);
            }
            
            listingStorage = [await getListing(1), await getListing(2)];
        } catch (error) {
            await logPageContent(mainPage);
            await logChannel.send("Error with interval: " + error);
        }
        interval();
    }, getRandomInterval());
} 