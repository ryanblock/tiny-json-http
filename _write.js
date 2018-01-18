var qs = require('querystring')
var http = require('http')
var https = require('https')
var FormData = require('@brianleroux/form-data')
var url = require('url')

module.exports = function _write(httpMethod, options, callback) {

  // require options.url or fail noisily
  if (!options.url) {
    throw Error('options.url required')
  }

  // setup promise if there is no callback
  var promise
  if (!callback) {
    promise = new Promise(function(res, rej) {
      callback = function(err, result) {
        err ? rej(err) : res(result)
      }
    })
  }

  // parse out the options from options.url
  var opts = url.parse(options.url)
  var method = opts.protocol === 'https:'? https.request : http.request
  var defaultContentType = 'application/json; charset=utf-8'

  // put the params on the query
  if (httpMethod === 'DELETE' && options.data) {
    var isSearch = !!opts.search
    options.url += (isSearch? '&' : '?') + qs.stringify(options.data)
    opts = url.parse(options.url)
  }

  // wrangle defaults
  opts.method = httpMethod
  opts.rejectUnauthorized = false
  opts.headers = options.headers || {}
  opts.headers['User-Agent'] = opts.headers['User-Agent'] || 'tiny-http'
  opts.headers['Content-Type'] = opts.headers['Content-Type'] || defaultContentType

  // default to regular POST body (url enc)
  var postData = qs.stringify(options.data || {})
  var contentTypeEquals = c=> opts.headers['Content-Type'] && opts.headers['Content-Type'].startsWith(c)

  function is(headers, type) {
    var isU = headers['Content-Type'] && headers['Content-Type'].startsWith(type)
    var isL = headers['content-type'] && headers['content-type'].startsWith(type)
    return isU || isL
  }
  
  // if we're posting JSON stringify options.data
  var isJSON = is(opts.headers, 'application/json')
  if (isJSON) {
    postData = JSON.stringify(options.data || {})
  }

  // ensure we know the len ~after~ we set the postData
  opts.headers['Content-Length'] = postData.length
    
  // if we're doing a mutipart/form-data do that encoding
  // we'll overload `method` and use the custom form-data submit instead of http.request
  var isMultipart = contentTypeEquals('multipart/form-data')
  if (isMultipart) {
    method = function _multiPartFormDataPost(params, streamback) {
      var form = new FormData
      Object.keys(options.data).forEach(k=> {
        form.append(k, options.data[k])
      })
      form.submit(opts, function _submit(err, res) {
        if (err) callback(err)
        else streamback(res)
      })
    }
  }

  // make a request
  var req = method(opts, function(res) {
    var raw = [] // keep our buffers here
    var ok = res.statusCode >= 200 && res.statusCode < 300

    res.on('data', function _data(chunk) {
      raw.push(chunk)
    })

    res.on('end', function _end() {
      var err = null
      var result = null
  
      try {
        result = Buffer.concat(raw)

        if (!options.buffer) {
          var isJSON = is(res.headers, 'application/json')
          result = isJSON ? JSON.parse(result.toString()) : result.toString()
        }
      }
      catch (e) {
        err = e
      }

      if (!ok) {
        err = Error(httpMethod + ' failed with: ' + res.statusCode)
        err.raw = res
        err.body = result
        callback(err)
      } 
      else {
        callback(err, {body:result, headers:res.headers})
      }
    })
  })

  if (!isMultipart) {
    req.on('error', callback)
    req.write(postData)
    req.end()
  }

  return promise
}
