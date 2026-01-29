const normalizePhone = (phone) => {
    if (!phone || typeof phone !== 'string') return null;
  
    let cleaned = phone.replace(/[\s\-()]/g, '');
  
    if (cleaned.startsWith('234')) {
      cleaned = `+${cleaned}`;
    }
  
    if (cleaned.startsWith('0')) {
      cleaned = `+234${cleaned.slice(1)}`;
    }
  
    const nigeriaRegex = /^\+234(70|80|81|90|91)\d{8}$/;
  
    if (!nigeriaRegex.test(cleaned)) {
      return null;
    }
  
    if (cleaned.length !== 14) {
      return null;
    }
  
    return cleaned;
  };
  
  module.exports = { normalizePhone };
  