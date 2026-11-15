const emailRecipient = "algamaoi2002@hotmail.com";
const whatsappRecipient = "966544835151";
const maxBodyLength = 10000;

function getBooking(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  const booking = {
    name: typeof data.name === "string" ? data.name.trim() : "",
    phone: typeof data.phone === "string" ? data.phone.trim() : "",
    service: typeof data.service === "string" ? data.service.trim() : "",
    message: typeof data.message === "string" ? data.message.trim() : "",
  };

  if (
    booking.name.length < 2 ||
    booking.name.length > 120 ||
    !/^[+\d][\d\s().-]{6,24}$/.test(booking.phone) ||
    booking.service.length < 2 ||
    booking.service.length > 120 ||
    booking.message.length > 2000
  ) {
    return null;
  }

  return booking;
}

function getMissingConfiguration() {
  const requiredVariables = [
    "RESEND_API_KEY",
    "RESEND_FROM_EMAIL",
    "WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_TEMPLATE_NAME",
  ];
  const missing = requiredVariables.filter((name) => !process.env[name]);

  if (!/^v\d+\.\d+$/.test(process.env.WHATSAPP_API_VERSION || "")) {
    missing.push("WHATSAPP_API_VERSION");
  }

  return missing;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) {
        return res.status(403).json({ error: "forbidden_origin" });
      }
    } catch {
      return res.status(403).json({ error: "forbidden_origin" });
    }
  }

  let body = req.body;
  if (typeof body === "string") {
    if (body.length > maxBodyLength) {
      return res.status(413).json({ error: "payload_too_large" });
    }

    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "invalid_json" });
    }
  }

  const booking = getBooking(body);
  if (!booking) {
    return res.status(400).json({ error: "invalid_booking" });
  }

  const missingConfiguration = getMissingConfiguration();
  if (missingConfiguration.length > 0) {
    console.error("Booking notifications are not configured.", { missingConfiguration });
    return res.status(503).json({ error: "booking_unavailable" });
  }

  const emailText = [
    "تم استلام طلب حجز مكالمة استشارية جديد.",
    "",
    `الاسم: ${booking.name}`,
    `رقم الجوال: ${booking.phone}`,
    `الخدمة: ${booking.service}`,
    `تفاصيل المشروع: ${booking.message || "لم تتم إضافة تفاصيل"}`,
  ].join("\n");

  const templateParameters = [
    booking.name,
    booking.phone,
    booking.service,
    booking.message || "لم تتم إضافة تفاصيل",
  ].map((text) => ({ type: "text", text }));

  const whatsappLanguage = process.env.WHATSAPP_TEMPLATE_LANGUAGE || "ar";
  const graphVersion = process.env.WHATSAPP_API_VERSION;

  const [emailResult, whatsappResult] = await Promise.allSettled([
    fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL,
        to: [emailRecipient],
        subject: `طلب حجز مكالمة استشارية جديد من ${booking.name}`,
        text: emailText,
      }),
    }),
    fetch(
      `https://graph.facebook.com/${graphVersion}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: whatsappRecipient,
          type: "template",
          template: {
            name: process.env.WHATSAPP_TEMPLATE_NAME,
            language: { code: whatsappLanguage },
            components: [
              {
                type: "body",
                parameters: templateParameters,
              },
            ],
          },
        }),
      },
    ),
  ]);

  const emailStatus =
    emailResult.status === "fulfilled" ? emailResult.value.status : "request_failed";
  const whatsappStatus =
    whatsappResult.status === "fulfilled" ? whatsappResult.value.status : "request_failed";

  if (
    emailResult.status !== "fulfilled" ||
    !emailResult.value.ok ||
    whatsappResult.status !== "fulfilled" ||
    !whatsappResult.value.ok
  ) {
    console.error("One or more booking notifications failed.", { emailStatus, whatsappStatus });
    return res.status(502).json({ error: "notification_delivery_failed" });
  }

  return res.status(200).json({ ok: true });
};
