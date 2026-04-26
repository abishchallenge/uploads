const axios = require("axios");
const qs = require("qs");

exports.handler = async (event, context) => {

  // Allow only POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: "Welcome ! Here"
    };
  }

  try {
    const params = qs.parse(event.body);
    const regNo = params.txtregno;

    if (!regNo) {
      return {
        statusCode: 400,
        body: "Register number is required"
      };
    }

    const response = await axios({
      method: "POST",
      url: "https://msuniv.com/halltickets/april_2025/show-apr25-supple-exam-hallticket",
      data: qs.stringify({
        txtregno: regNo,
        show: "Show "
      }),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": "https://msuniv.com",
        "Origin": "https://msuniv.com",
        "User-Agent": "Mozilla/5.0"
      }
    });

    let html = response.data;

    if (!/<head>/i.test(html)) {
      html = `
      <html>
        <head>
          <base href="https://msuniv.com">
          <meta charset="UTF-8">
		  <meta name="referrer" content="no-referrer">        
        </head>
        <body>
          ${html}
        </body>
      </html>`;
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/html; charset=UTF-8"
      },
      body: html
    };

  } catch (error) {
    console.log(error);
    return {
      statusCode: 500,
      body: "Server Error"
    };
  }
};