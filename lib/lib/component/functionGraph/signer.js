// HWS API Gateway Signature
(function (root, factory) {
    "use strict";
    /*global define*/
    if (typeof define === 'function' && define.amd) {
        // AMD
        define(['CryptoJS'], function (CryptoJS) {
            var crypto_wrapper = {
                hmacsha256: function (keyByte, message) {
                    return CryptoJS.HmacSHA256(message, keyByte).toString(CryptoJS.enc.Hex);
                },
                HexEncodeSHA256Hash: function (body) {
                    return CryptoJS.SHA256(body);
                }
            };
            return factory(crypto_wrapper);
        });
    }
    else if (typeof wx === 'object') {
        // wechat
        var CryptoJS = require('./js/hmac-sha256.js');
        var crypto_wrapper = {
            hmacsha256: function (keyByte, message) {
                return CryptoJS.HmacSHA256(message, keyByte).toString(CryptoJS.enc.Hex);
            },
            HexEncodeSHA256Hash: function (body) {
                return CryptoJS.SHA256(body);
            }
        };
        module.exports = factory(crypto_wrapper);
    }
    else if (typeof module === 'object' && module.exports) {
        // Node
        var crypto = require('crypto');
        var crypto_wrapper = {
            hmacsha256: function (keyByte, message) {
                return crypto.createHmac('SHA256', keyByte).update(message).digest().toString('hex');
            },
            HexEncodeSHA256Hash: function (body) {
                return crypto.createHash('SHA256').update(body).digest().toString('hex');
            }
        };
        module.exports = factory(crypto_wrapper);
    }
    else {
        // Browser
        var CryptoJS = root.CryptoJS;
        var crypto_wrapper = {
            hmacsha256: function (keyByte, message) {
                return CryptoJS.HmacSHA256(message, keyByte).toString(CryptoJS.enc.Hex);
            },
            HexEncodeSHA256Hash: function (body) {
                return CryptoJS.SHA256(body);
            }
        };
        root.signer = factory(crypto_wrapper);
    }
}(this, function (crypto_wrapper) {
    'use strict';
    var Algorithm = "SDK-HMAC-SHA256";
    var HeaderXDate = "X-Sdk-Date";
    var HeaderAuthorization = "Authorization";
    var HeaderContentSha256 = "x-sdk-content-sha256";
    var hexTable = new Array(256);
    for (var i = 0; i < 256; ++i)
        hexTable[i] = '%' + ((i < 16 ? '0' : '') + i.toString(16)).toUpperCase();
    var noEscape = [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1,
        0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0 // 112 - 127
    ];
    // function urlEncode is based on https://github.com/nodejs/node/blob/master/lib/querystring.js
    // Copyright Joyent, Inc. and other Node contributors.
    function urlEncode(str) {
        if (typeof str !== 'string') {
            if (typeof str === 'object')
                str = String(str);
            else
                str += '';
        }
        var out = '';
        var lastPos = 0;
        for (var i = 0; i < str.length; ++i) {
            var c = str.charCodeAt(i);
            // ASCII
            if (c < 0x80) {
                if (noEscape[c] === 1)
                    continue;
                if (lastPos < i)
                    out += str.slice(lastPos, i);
                lastPos = i + 1;
                out += hexTable[c];
                continue;
            }
            if (lastPos < i)
                out += str.slice(lastPos, i);
            // Multi-byte characters ...
            if (c < 0x800) {
                lastPos = i + 1;
                out += hexTable[0xC0 | (c >> 6)] + hexTable[0x80 | (c & 0x3F)];
                continue;
            }
            if (c < 0xD800 || c >= 0xE000) {
                lastPos = i + 1;
                out += hexTable[0xE0 | (c >> 12)] +
                    hexTable[0x80 | ((c >> 6) & 0x3F)] +
                    hexTable[0x80 | (c & 0x3F)];
                continue;
            }
            // Surrogate pair
            ++i;
            if (i >= str.length)
                throw new errors.URIError('ERR_INVALID_URI');
            var c2 = str.charCodeAt(i) & 0x3FF;
            lastPos = i + 1;
            c = 0x10000 + (((c & 0x3FF) << 10) | c2);
            out += hexTable[0xF0 | (c >> 18)] +
                hexTable[0x80 | ((c >> 12) & 0x3F)] +
                hexTable[0x80 | ((c >> 6) & 0x3F)] +
                hexTable[0x80 | (c & 0x3F)];
        }
        if (lastPos === 0)
            return str;
        if (lastPos < str.length)
            return out + str.slice(lastPos);
        return out;
    }
    function HttpRequest(method, url, headers, body) {
        if (method === undefined) {
            this.method = "";
        }
        else {
            this.method = method;
        }
        if (url === undefined) {
            this.host = "";
            this.uri = "";
            this.query = {};
        }
        else {
            this.query = {};
            var host, path;
            var i = url.indexOf("://");
            if (i !== -1) {
                url = url.substr(i + 3);
            }
            var i = url.indexOf("?");
            if (i !== -1) {
                var query_str = url.substr(i + 1);
                url = url.substr(0, i);
                var spl = query_str.split("&");
                for (var i in spl) {
                    var kv = spl[i];
                    var index = kv.indexOf('=');
                    var key, value;
                    if (index >= 0) {
                        key = kv.substr(0, index);
                        value = kv.substr(index + 1);
                    }
                    else {
                        key = kv;
                        value = "";
                    }
                    if (key !== "") {
                        key = decodeURI(key);
                        value = decodeURI(value);
                        if (this.query[key] === undefined) {
                            this.query[key] = [value];
                        }
                        else {
                            this.query[key].push(value);
                        }
                    }
                }
            }
            var i = url.indexOf("/");
            if (i === -1) {
                host = url;
                path = "/";
            }
            else {
                host = url.substr(0, i);
                path = url.substr(i);
            }
            this.host = host;
            this.uri = decodeURI(path);
        }
        if (headers === undefined) {
            this.headers = {};
        }
        else {
            this.headers = headers;
        }
        if (body === undefined) {
            this.body = "";
        }
        else {
            this.body = body;
        }
    }
    function findHeader(r, header) {
        for (var k in r.headers) {
            if (k.toLowerCase() === header.toLowerCase()) {
                return r.headers[k];
            }
        }
        return null;
    }
    // Build a CanonicalRequest from a regular request string
    //
    // CanonicalRequest =
    //  HTTPRequestMethod + '\n' +
    //  CanonicalURI + '\n' +
    //  CanonicalQueryString + '\n' +
    //  CanonicalHeaders + '\n' +
    //  SignedHeaders + '\n' +
    //  HexEncode(Hash(RequestPayload))
    function CanonicalRequest(r, signedHeaders) {
        var hexencode = findHeader(r, HeaderContentSha256);
        if (hexencode === null) {
            var data = RequestPayload(r);
            hexencode = crypto_wrapper.HexEncodeSHA256Hash(data);
        }
        return r.method + "\n" + CanonicalURI(r) + "\n" + CanonicalQueryString(r) + "\n" + CanonicalHeaders(r, signedHeaders) + "\n" + signedHeaders.join(';') + "\n" + hexencode;
    }
    function CanonicalURI(r) {
        var pattens = r.uri.split('/');
        var uri = [];
        for (var k in pattens) {
            var v = pattens[k];
            uri.push(urlEncode(v));
        }
        var urlpath = uri.join('/');
        if (urlpath[urlpath.length - 1] !== '/') {
            urlpath = urlpath + '/';
        }
        //r.uri = urlpath
        return urlpath;
    }
    function CanonicalQueryString(r) {
        var keys = [];
        for (var key in r.query) {
            keys.push(key);
        }
        keys.sort();
        var a = [];
        for (var i in keys) {
            var key = urlEncode(keys[i]);
            var value = r.query[keys[i]];
            if (Array.isArray(value)) {
                value.sort();
                for (var iv in value) {
                    a.push(key + '=' + urlEncode(value[iv]));
                }
            }
            else {
                a.push(key + '=' + urlEncode(value));
            }
        }
        return a.join('&');
    }
    function CanonicalHeaders(r, signedHeaders) {
        var headers = {};
        for (var key in r.headers) {
            headers[key.toLowerCase()] = r.headers[key];
        }
        var a = [];
        for (var i in signedHeaders) {
            var value = headers[signedHeaders[i]];
            a.push(signedHeaders[i] + ':' + value.trim());
        }
        return a.join('\n') + "\n";
    }
    function SignedHeaders(r) {
        var a = [];
        for (var key in r.headers) {
            a.push(key.toLowerCase());
        }
        a.sort();
        return a;
    }
    function RequestPayload(r) {
        return r.body;
    }
    // Create a "String to Sign".
    function StringToSign(canonicalRequest, t) {
        var bytes = crypto_wrapper.HexEncodeSHA256Hash(canonicalRequest);
        return Algorithm + "\n" + t + "\n" + bytes;
    }
    // Create the HWS Signature.
    function SignStringToSign(stringToSign, signingKey) {
        return crypto_wrapper.hmacsha256(signingKey, stringToSign);
    }
    // Get the finalized value for the "Authorization" header.  The signature
    // parameter is the output from SignStringToSign
    function AuthHeaderValue(signature, Key, signedHeaders) {
        return Algorithm + " Access=" + Key + ", SignedHeaders=" + signedHeaders.join(';') + ", Signature=" + signature;
    }
    function twoChar(s) {
        if (s >= 10) {
            return "" + s;
        }
        else {
            return "0" + s;
        }
    }
    function getTime() {
        var date = new Date();
        return "" + date.getUTCFullYear() + twoChar(date.getUTCMonth() + 1) + twoChar(date.getUTCDate()) + "T" +
            twoChar(date.getUTCHours()) + twoChar(date.getUTCMinutes()) + twoChar(date.getUTCSeconds()) + "Z";
    }
    function Signer() {
        this.Key = "";
        this.Secret = "";
    }
    Signer.prototype.Sign = function (r) {
        var headerTime = findHeader(r, HeaderXDate);
        if (headerTime === null) {
            headerTime = getTime();
            r.headers[HeaderXDate] = headerTime;
        }
        if (r.method !== "PUT" && r.method !== "PATCH" && r.method !== "POST") {
            r.body = "";
        }
        var queryString = CanonicalQueryString(r);
        if (queryString !== "") {
            queryString = "?" + queryString;
        }
        var options = {
            hostname: r.host,
            path: encodeURI(r.uri) + queryString,
            method: r.method,
            headers: r.headers
        };
        if (findHeader(r, 'host') === null) {
            r.headers.host = r.host;
        }
        var signedHeaders = SignedHeaders(r);
        var canonicalRequest = CanonicalRequest(r, signedHeaders);
        var stringToSign = StringToSign(canonicalRequest, headerTime);
        var signature = SignStringToSign(stringToSign, this.Secret);
        options.headers[HeaderAuthorization] = AuthHeaderValue(signature, this.Key, signedHeaders);
        return options;
    };
    return {
        HttpRequest: HttpRequest,
        Signer: Signer,
        urlEncode: urlEncode,
        findHeader: findHeader,
        SignedHeaders: SignedHeaders,
        CanonicalRequest: CanonicalRequest,
        StringToSign: StringToSign,
    };
}));
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2lnbmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2xpYi9jb21wb25lbnQvZnVuY3Rpb25HcmFwaC9zaWduZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsNEJBQTRCO0FBQzVCLENBQUMsVUFBVSxJQUFJLEVBQUUsT0FBTztJQUNwQixZQUFZLENBQUM7SUFFYixpQkFBaUI7SUFDakIsSUFBSSxPQUFPLE1BQU0sS0FBSyxVQUFVLElBQUksTUFBTSxDQUFDLEdBQUcsRUFBRTtRQUM1QyxNQUFNO1FBQ04sTUFBTSxDQUFDLENBQUMsVUFBVSxDQUFDLEVBQUUsVUFBVSxRQUFRO1lBQ25DLElBQUksY0FBYyxHQUFHO2dCQUNqQixVQUFVLEVBQUUsVUFBVSxPQUFPLEVBQUUsT0FBTztvQkFDbEMsT0FBTyxRQUFRLENBQUMsVUFBVSxDQUFDLE9BQU8sRUFBRSxPQUFPLENBQUMsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQTtnQkFDM0UsQ0FBQztnQkFDRCxtQkFBbUIsRUFBRSxVQUFVLElBQUk7b0JBQy9CLE9BQU8sUUFBUSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQTtnQkFDaEMsQ0FBQzthQUNKLENBQUM7WUFDRixPQUFPLE9BQU8sQ0FBQyxjQUFjLENBQUMsQ0FBQTtRQUNsQyxDQUFDLENBQUMsQ0FBQztLQUNOO1NBQU0sSUFBSSxPQUFPLEVBQUUsS0FBSyxRQUFRLEVBQUU7UUFDL0IsU0FBUztRQUNULElBQUksUUFBUSxHQUFHLE9BQU8sQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDO1FBQzlDLElBQUksY0FBYyxHQUFHO1lBQ2pCLFVBQVUsRUFBRSxVQUFVLE9BQU8sRUFBRSxPQUFPO2dCQUNsQyxPQUFPLFFBQVEsQ0FBQyxVQUFVLENBQUMsT0FBTyxFQUFFLE9BQU8sQ0FBQyxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxD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LEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQztRQUM5QyxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDO1FBQzlDLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUM7UUFDOUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQztRQUM5QyxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDO1FBQzlDLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUM7UUFDOUMsQ0FBQyxFQUFFLENBQUMsRUFB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