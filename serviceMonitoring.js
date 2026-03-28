const pm2 = require('pm2');
const nodemailer = require('nodemailer');
const winston = require('winston');
const path = require('path');
require('dotenv').config();

// --- WINSTON KONFIGURATION ---
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}]: ${message}`)
    ),
    transports: [
        // Skriver fel till error.log
        new winston.transports.File({ 
            filename: path.join(__dirname, 'logs/error.log'), 
            level: 'error' 
        }),
        // Skriver allt till combined.log
        new winston.transports.File({ 
            filename: path.join(__dirname, 'logs/combined.log') 
        }),
        // Visar i terminalen med färger
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    },
    tls: { rejectUnauthorized: false }
});

// --- TEST-MAIL VID START ---
async function sendStartupTest() {
    logger.info("📤 Försöker skicka ett test-mail för att verifiera anslutningen...");
    try {
        await transporter.sendMail({
            from: `"${process.env.FROM_NAME}" <${process.env.SMTP_FROM_EMAIL}>`,
            to: process.env.SMTP_TO_EMAIL,
            subject: `✅ Monitor Startad - ${new Date().toLocaleTimeString()}`,
            text: `Detta är ett bekräftelsemail. PM2-monitorn har startat korrekt!`
        });
        logger.info("✅ Test-mail skickat utan problem.");
    } catch (err) {
        logger.error(`❌ Kunde inte skicka test-mail vid start: ${err.message}`);
    }
}

sendStartupTest();

let alertedApps = new Set();

function checkProcesses() {
    pm2.connect((err) => {
        if (err) {
            logger.error("Kunde inte ansluta till PM2-daemon");
            return;
        }

        pm2.list((err, list) => {
            if (err) {
                pm2.disconnect();
                return;
            }

            list.forEach(proc => {
                const name = proc.name;
                const status = proc.pm2_env.status;

                if (name === 'PM2-Watcher') return; 

                if (status === 'errored' || status === 'stopped') {
                    if (!alertedApps.has(name)) {
                        sendAlert(name, status);
                        alertedApps.add(name);
                    }
                } 
                else if (status === 'online') {
                    alertedApps.delete(name);
                }
            });
            pm2.disconnect();
        });
    });
}

async function sendAlert(appName, status) {
    logger.warn(`⚠️ ALARM: ${appName} är ${status}! Initierar larm-mail...`);
    try {
        await transporter.sendMail({
            from: `"${process.env.FROM_NAME}" <${process.env.SMTP_FROM_EMAIL}>`,
            to: process.env.SMTP_TO_EMAIL,
            subject: `${process.env.SUBJECT} ${appName}`,
            text: `Hej!\n\nDin process "${appName}" har slutat fungera.\n` +
                  `Status: ${status}\n\n` +
                  `Dashboard: ${process.env.DASHBOARD_URL}\n\n` +
                  `Med vänlig hälsning,\n${process.env.FROM_NAME}`
        });
        logger.info(`📧 Larm-mail har skickats till ${process.env.SMTP_TO_EMAIL} för ${appName}`);
    } catch (err) {
        logger.error(`❌ Misslyckades att skicka larm för ${appName}: ${err.message}`);
    }
}

setInterval(checkProcesses, 30000);
logger.info("🚀 PM2 Monitor är igång och bevakar systemet...");
