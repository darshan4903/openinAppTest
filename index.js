const express = require("express");
const app = express();
const { google } = require("googleapis");
const { OAuth2Client } = require("google-auth-library");
const nodemailer = require("nodemailer");
//Credentials
const clientId = "Your_Client_ID";
const clientSecret = "Your_Client_Secret";
const redirectUri = "Your_Redirect_Uri";
const refreshToken = "Your_Refresh_Token";

const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);
oauth2Client.setCredentials({
  refresh_token: refreshToken,
});

const repliedEmails = new Set(); // Set to store replied email id

async function getAccess() {
  try {
    const r = await oauth2Client.getAccessToken();//Retreiving access token
    const accessToken = r.token;

    const authClient = new google.auth.OAuth2();//Creating a new instance of authClient
    authClient.setCredentials({ access_token: accessToken });

    const gmail = google.gmail({ version: "v1", auth: authClient });//Creating a gmail client

    const res = await gmail.users.messages.list({ userId: "me", includeSpamTrash: false });
    const messages = res.data.messages;

    if (messages.length === 0) {
      console.log("No messages found.");
      return [];
    }

    const emailPromises = messages.slice(0, 30).map(async (message) => {
      const res = await gmail.users.messages.get({ userId: "me", id: message.id });
      const data = res.data;
      const threadId = data.threadId;
      const subject = data.payload.headers.find((header) => header.name === "Subject").value;
      const sender = data.payload.headers.find((header) => header.name === "From").value;
      const snippet = data.snippet;

      // Check if the sender has sent the mail only once
      const senderEmailsRes = await gmail.users.messages.list({
        userId: "me",
        q: `from:${sender}`,
      });
      const senderEmails = senderEmailsRes.data.messages || [];
      const senderEmailCount = senderEmails.length;

      if (senderEmailCount === 1 && !repliedEmails.has(message.id)) {
        return {
          messageId: message.id,
          threadId,
          subject,
          sender,
          snippet,
        };
      }

      return null;
    });

    const emailData = (await Promise.all(emailPromises)).filter((email) => email !== null);
    console.log(emailData.length);
    return emailData;
  } catch (e) {
    console.log(e);
    return [];
  }
}

app.get("/", async (req, res) => {
  const emailData = await getAccess();

  const transporter = nodemailer.createTransport({
    service: "Gmail",
    auth: {
      user: "Your_Mail_Id", // Replace with your Gmail email address
      pass: "Mail_Password", // Replace with your Gmail password
    },
  });

  const authClient = new google.auth.OAuth2();
  authClient.setCredentials({ access_token: oauth2Client.credentials.access_token });

  const gmail = google.gmail({ version: "v1", auth: authClient });

  const replyPromises = emailData.map(async (email) => {
    const mailOptions = {
      from: "Your_Mail_Id", // Replace with your Gmail email address
      to: email.sender,
      subject: "Reply from BOT",
      text: "We will reply to you soon.",
    };

    const response = await transporter.sendMail(mailOptions);

    // Change label to "bot" for the replied email
    await gmail.users.messages.modify({
      userId: "me",
      id: email.messageId,
      resource: {
        addLabelIds: ["Your_Label_Id"],//Label id
      },
    });

    repliedEmails.add(email.messageId); // Add the replied email ID to the Set

    return response;
  });

  const replyResponses = await Promise.all(replyPromises);
  console.log("Replied to senders:", replyResponses.length);

  res.send(emailData);
  console.log(emailData);
});

app.listen(4000, () => {
  console.log("Server is running on port 4000");
});

// Periodically check for new emails every 60 seconds
setInterval(async () => {
  console.log("Checking for new emails...");
  const emailData = await getAccess();

  const transporter = nodemailer.createTransport({
    service: "Gmail",
    auth: {
      user: "Your_Mail_Id", // Replace with your Gmail email address
      pass: "Your_Password", // Replace with your Gmail password
    },
  });

  const authClient = new google.auth.OAuth2();
  authClient.setCredentials({ access_token: oauth2Client.credentials.access_token });

  const gmail = google.gmail({ version: "v1", auth: authClient });

  const replyPromises = emailData.map(async (email) => {
    if (!repliedEmails.has(email.messageId)) { // Check if the email has already been replied to
      const mailOptions = {
        from: "Your_Mail_Id", // Replace with your Gmail email address
        to: email.sender,
        subject: "Reply from BOT",
        text: "We will reply to you soon.",
      };

      const response = await transporter.sendMail(mailOptions);

      // Change label to "bot" for the replied email
      await gmail.users.messages.modify({
        userId: "me",
        id: email.messageId,
        resource: {
          addLabelIds: ["Your_Label_Id"],//Replace with your label id 
        },
      });

      repliedEmails.add(email.messageId); // Add the replied email ID to the Set

      return response;
    }

    return null;
  });

  const replyResponses = await Promise.all(replyPromises);
  const validReplyResponses = replyResponses.filter((response) => response !== null);
  console.log("Replied to senders:", validReplyResponses.length);

  console.log(emailData);
}, 60000); // Run every 60 seconds
