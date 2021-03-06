sap.ui.define([
	'jquery.sap.global',
	'sap/ui/thirdparty/sinon'
], function (jQuery, sinon) {
	"use strict";

	var oSandbox = sinon.sandbox.create(),
		aUsers,
		sMetadata,
		sBaseUrl = "http://services.odata.org/TripPinRESTierService/(S(euc2jaq2ryeoswu4hs4unp33))/",
		// Need to escape the brackets in the base URL for using it in a RegExp
		sEscapedBaseUrl = sBaseUrl.replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/\./g, "\\."),
		rBaseUrl = new RegExp(sEscapedBaseUrl);

	return {

		/**
		 * Creates a Sinon fake service, intercepting all http requests to
		 * the URL defined in variable sBaseUrl above.
		 */
		start : function () {
			// Read the mock data
			readData();
			// Initialize the sinon fake server
			oSandbox.useFakeServer();
			// Make sure that requests are responded to automatically. Otherwise we would need to do that manually.
			oSandbox.server.autoRespond = true;

			// Register the requests for which responses should be faked.
			oSandbox.server.respondWith(rBaseUrl, handleAllRequests);

			// Apply a filter to the fake XmlHttpRequest. Otherwise, ALL requests (e.g. our component, views etc.) would be intercepted.
			sinon.FakeXMLHttpRequest.useFilters = true;
			sinon.FakeXMLHttpRequest.addFilter(function (sMethod, sUrl) {
				// If the filter returns true, the request will NOT be faked.
				// We only want to fake requests that go to 'our' service.
				return !rBaseUrl.test(sUrl);
			});
		},

		/**
		 * Stops the request interception and deletes the Sinon fake server.
		 */
		stop : function () {
			sinon.FakeXMLHttpRequest.filters = [];
			sinon.FakeXMLHttpRequest.useFilters = false;
			oSandbox.restore();
			oSandbox = null;
		}
	};

	/**
	 * Looks for a user with a given user name and returns its index in the user array.
	 * @param {String} sUserName - the user name to look for.
	 * @returns {Integer} index of that user in the array, or undefined.
	 */
	function findUserIndex(sUserName) {
		for (var i = 0; i < aUsers.length; i++) {
			if (aUsers[i].UserName === sUserName) {
				return i;
			}
		}
	}

	/**
	 * Retrieves any user data from a given http request body.
	 * @param {String} sBody - the http request body.
	 * @returns {Object} the parsed user data.
	 */
	function getUserDataFromRequestBody(sBody) {
		var aMatches = sBody.match(/({.+})/);
		if (!aMatches || !aMatches.length || !(aMatches.length === 2)) {
			throw new Error("Could not find any user data in " + sBody);
		}
		return JSON.parse(aMatches[1]);
	}

	/**
	 * Retrieves a user name from a given request URL.
	 * @param {String} sUrl - the request URL.
	 * @returns {String} the user name.
	 */
	function getUserKeyFromUrl(sUrl) {
		var aMatches = sUrl.match(/People\('(.+)'\)/);
		if (!aMatches || !aMatches.length || !(aMatches.length === 2)) {
			throw new Error("Could not find a user key in " + sUrl);
		}
		return aMatches[1];
	}

	/**
	 * Reads and caches the fake service metadata and data from their
	 * respective files.
	 */
	function readData() {
		var oResult;

		// Read metadata file
		oResult = jQuery.sap.sjax({
			url : "./localService/metadata.xml",
			dataType : "text"
		});
		if (!oResult.success) {
			throw new Error("'./localService/metadata.xml'" + ": resource not found");
		} else {
			sMetadata = oResult.data;
		}

		oResult = jQuery.sap.sjax({
			url : "./localService/mockdata/people.json",
			dataType : "text"
		});
		if (!oResult.success) {
			throw new Error("'./localService/mockdata/people.json'" + ": resource not found");
		} else {
			aUsers = JSON.parse(oResult.data).value;
		}
	}

	/**
	 * Reduces a given result set by applying the OData URL parameters 'skip' and 'top' to it.
	 * Does NOT change the given result set but returns a new array.
	 * @param {Object} oXhr - the Sinon fake XMLHttpRequest
	 * @param {Array} aResultSet - the result set to be reduced.
	 * @returns {Array} the reduced result set.
	 */
	function applySkipTop(oXhr, aResultSet) {
		var iSkip,
			iTop,
			aReducedUsers = [].concat(aResultSet),
			aMatches = oXhr.url.match(/\$skip=(\d+)&\$top=(\d+)/);

		if (aMatches && aMatches.length && aMatches.length >= 3) {
			iSkip = aMatches[1];
			iTop = aMatches[2];
			return aResultSet.slice(iSkip, iSkip + iTop);
		}

		return aReducedUsers;
	}

	/**
	 * Sorts a given result set by applying the OData URL parameter 'orderby'.
	 * Does NOT change the given result set but returns a new array.
	 * @param {Object} oXhr - the Sinon fake XMLHttpRequest
	 * @param {Array} aResultSet - the result set to be sorted.
	 * @returns {Array} the sorted result set.
	 */
	function applySort(oXhr, aResultSet) {
		var sFieldName,
			sDirection,
			aSortedUsers = [].concat(aResultSet), // work with a copy
			aMatches = oXhr.url.match(/\$orderby=(\w*)(?:%20(\w*))?/);

		if (!aMatches || !aMatches.length || aMatches.length < 2) {
			return aSortedUsers;
		} else {
			sFieldName = aMatches[1];
			sDirection = aMatches[2] || "asc";

			if (sFieldName !== "LastName") {
				throw new Error("Filters on field " + sFieldName + " are not supported.");
			}

			aSortedUsers.sort(function (a, b) {
				var nameA = a.LastName.toUpperCase();
				var nameB = b.LastName.toUpperCase();
				var bAsc = sDirection === "asc";

				if (nameA < nameB) {
					return bAsc ? -1 : 1;
				}
				if (nameA > nameB) {
					return bAsc ? 1 : -1;
				}
				return 0;
			});

			return aSortedUsers;
		}
	}

	/**
	 * Filters a given result set by applying the OData URL parameter 'filter'.
	 * Does NOT change the given result set but returns a new array.
	 * @param {Object} oXhr - the Sinon fake XMLHttpRequest
	 * @param {Array} aResultSet - the result set to be filtered.
	 * @returns {Array} the filtered result set.
	 */
	function applyFilter(oXhr, aResultSet) {
		var sFieldName,
			sQuery,
			aFilteredUsers = [].concat(aResultSet), // work with a copy
			aMatches = oXhr.url.match(/\$filter=.*\((.*),'(.*)'\)/);

		// If the request contains a filter command, apply the filter
		if (aMatches && aMatches.length && aMatches.length >= 3) {
			sFieldName = aMatches[1];
			sQuery = aMatches[2];

			if (sFieldName !== "LastName") {
				throw new Error("Filters on field " + sFieldName + " are not supported.");
			}

			aFilteredUsers = aUsers.filter(function (oUser) {
				return oUser.LastName.indexOf(sQuery) !== -1;
			});
		}

		return aFilteredUsers;
	}

	/**
	 * Handles GET requests for metadata.
	 * @returns {Array} an array with the response information needed by Sinon's respond() function
	 */
	function handleGetMetadataRequests() {
		return [
			200,
			{
				"Content-Type" : "application/xml",
				"odata-version" : "4.0"
			}, sMetadata
		];
	}

	/**
	 * Handles GET requests for a pure user count and returns a fitting response.
	 * @returns {Array} an array with the response information needed by Sinon's respond() function
	 */
	function handleGetCountRequests() {
		return [
			200,
			{
				"Content-Type" : "text/plain;charset=UTF-8;IEEE754Compatible=true",
				"OData-Version" : "4.0"
			},
			aUsers.length.toString()
		];
	}

	/**
	 * Handles GET requests for user data and returns a fitting response.
	 * @param {Object} oXhr - the Sinon fake XMLHttpRequest
	 * @param {boolean} bCount - true if the request should include a counter
	 * @returns {Array} an array with the response information needed by Sinon's respond() function
	 */
	function handleGetUserRequests(oXhr, bCount) {
		var iCount,
			sCount = "",
			aResult,
			sResponse;

		// Get the data filtered, sorted and reduced according to skip + top
		aResult = applyFilter(oXhr, aUsers);
		iCount = aResult.length; // the total no. of people found, after filtering
		aResult = applySort(oXhr, aResult);
		aResult = applySkipTop(oXhr, aResult);

		if (bCount) {
			sCount = '"@odata.count": ' + iCount + ',';
		}

		sResponse = '{"@odata.context": "' + sBaseUrl + '$metadata#People(Age,FirstName,LastName,UserName)",' +
			sCount +
			'"value": ' + JSON.stringify(aResult) +
			"}";

		return [
			200,
			{
				"Content-Type" : "application/json; odata.metadata=minimal",
				"OData-Version" : "4.0"
			},
			sResponse
		];
	}

	/**
	 * Handles PATCH requests for users and returns a fitting response.
	 * Changes the user data according to the request.
	 * @param {Object} oXhr - the Sinon fake XMLHttpRequest
	 * @returns {Array} an array with the response information needed by Sinon's respond() function
	 */
	function handlePatchUserRequests(oXhr) {
		var sKey,
			oUser,
			oChanges;

		// Get the key of the person to change
		sKey = getUserKeyFromUrl(oXhr.url);

		// Get the list of changes
		oChanges = getUserDataFromRequestBody(oXhr.requestBody);

		// Now make the change(s)
		oUser = aUsers[findUserIndex(sKey)];
		for (var sFieldName in oChanges) {
			oUser[sFieldName] = oChanges[sFieldName];
		}

		// The response to PATCH requests is always http 204 (No Content)
		return [
			204,
			{
				"Content-Type" : "application/json; odata.metadata=minimal",
				"OData-Version" : "4.0"
			},
			null];
	}

	/**
	 * Handles DELETE requests for users and returns a fitting response.
	 * Deletes the user according to the request.
	 * @param {Object} oXhr - the Sinon fake XMLHttpRequest
	 * @returns {Array} an array with the response information needed by Sinon's respond() function
	 */
	function handleDeleteUserRequests(oXhr) {
		var sKey;

		sKey = getUserKeyFromUrl(oXhr.url);
		aUsers.splice(findUserIndex(sKey), 1);

		// The response to DELETE requests is always http 204 (No Content)
		return [
			204,
			{
				"OData-Version" : "4.0"
			},
			null
		];
	}

	/**
	 * Handles POST requests for users and returns a fitting response.
	 * Creates a new user according to the request.
	 * Does NOT check for duplicate user names because that is how the live service behaves.
	 * @param {Object} oXhr - the Sinon fake XMLHttpRequest
	 * @returns {Array} an array with the response information needed by Sinon's respond() function
	 */
	function handlePostUserRequests(oXhr) {
		var oUser,
			sResponse;

		oUser = getUserDataFromRequestBody(oXhr.requestBody);
		aUsers.push(oUser);

		sResponse = '{"@odata.context": "' + sBaseUrl + '/$metadata#People/$entity",';
		// for (var sField in oUser) {
		// 	sResponse += JSON.stringify()
		// }
		// sResponse += '}';
		sResponse += JSON.stringify(oUser).slice(1);

		// The response to POST requests is http 201 (Created)
		return [
			201,
			{
				"Content-Type" : "application/json; odata.metadata=minimal",
				"OData-Version" : "4.0"
			},
			sResponse
		];
	}

	/**
	 * Handles POST requests for resetting the data and returns a fitting response.
	 * Reloads the base user data from file.
	 * Does NOT check for duplicate user names because that is how the live service behaves.
	 * @returns {Array} an array with the response information needed by Sinon's respond() function
	 */
	function handleResetDataRequest() {
		readData();

		return [
			204,
			{
				"OData-Version" : "4.0"
			},
			null
		];
	}

	/**
	 * Builds a responds to direct (= non-batch) requests.
	 * Supports GET, PATCH, DELETE and POST requests.
	 * @param {Object} oXhr - the Sinon fake XMLHttpRequest
	 * @returns {Array} an array with the response information needed by Sinon's respond() function
	 */
	function handleDirectRequest(oXhr) {
		var aResponse;

		switch (oXhr.method) {
			case "GET":
				if (/\$metadata/.test(oXhr.url)) {
					aResponse = handleGetMetadataRequests();
				} else if (/\/\$count/.test(oXhr.url)) {
					aResponse = handleGetCountRequests();
				} else if (/People\?/.test(oXhr.url)) {
					aResponse = handleGetUserRequests(oXhr, /\$count=true/.test(oXhr.url));
				}
				break;
			case "PATCH":
				if (/People/.test(oXhr.url)) {
					aResponse = handlePatchUserRequests(oXhr);
				}
				break;
			case "POST":
				if (/People/.test(oXhr.url)) {
					aResponse = handlePostUserRequests(oXhr);
				} else if (/ResetDataSource/.test(oXhr.url)) {
					aResponse = handleResetDataRequest();
				}
				break;
			case "DELETE":
				if (/People/.test(oXhr.url)) {
					aResponse = handleDeleteUserRequests(oXhr);
				}
				break;
			default:
				break;
		}

		return aResponse;
	}

	/**
	 * Builds a responds to batch requests.
	 * Unwraps batch request, gets a response for each individual part and
	 * constructs a fitting batch response.
	 * @param {Object} oXhr - the Sinon fake XMLHttpRequest
	 * @returns {Array} an array with the response information needed by Sinon's respond() function
	 */
	function handleBatchRequest(oXhr) {
		var aResponse,
			sResponseBody = "",
			sOuterBoundary = oXhr.requestBody.match(/(.*)/)[1], // First line of the body
			sInnerBoundary,
			sPartBoundary,
			aOuterParts = oXhr.requestBody.split(sOuterBoundary).slice(1, -1), // The individual requests
			aParts,
			aMatches;

		aMatches = aOuterParts[0].match(/multipart\/mixed;boundary=(.+)/);
		// If this request has several change sets, then we need to handle the inner and outer boundaries
		// (change sets have an additional boundary)
		if (aMatches && aMatches.length > 0) {
			sInnerBoundary = aMatches[1];
			aParts = aOuterParts[0].split("--" + sInnerBoundary).slice(1, -1);

		} else  {
			aParts = aOuterParts;
		}

		// If this request has several change sets, then our response must start with the outer boundary and
		// content header
		if (sInnerBoundary) {
			sPartBoundary = "--" + sInnerBoundary;
			sResponseBody += sOuterBoundary + "\r\n" +
				"Content-Type: multipart/mixed; boundary=" + sInnerBoundary + "\r\n\r\n";
		} else {
			sPartBoundary = sOuterBoundary;
		}

		aParts.forEach(function (sPart, iIndex) {
			// Construct the batch response body out of the single batch request parts.
			// The RegExp looks for a request body at the end of the string, framed by two line breaks.
			var aMatches = sPart.match(/(GET|DELETE|PATCH|POST) (\S+)(?:.|\r?\n)+\r?\n(.*)\r?\n$/);
			var aPartResponse = handleDirectRequest({
				method : aMatches[1],
				url : aMatches[2],
				requestBody : aMatches[3]
			});
			sResponseBody += sPartBoundary + "\r\n" +
				"Content-Type: application/http\r\n";
			// If there are several change sets, we need to add a Content ID header
			if (sInnerBoundary) {
				sResponseBody += "Content-ID:" + iIndex + ".0\r\n";
			}
			sResponseBody += "\r\nHTTP/1.1 " + aPartResponse[0] + "\r\n";
			// Add any headers from the request - unless this response is 204 (no content)
			if (aPartResponse[1] && aPartResponse[0] !== 204) {
				for (var sHeader in aPartResponse[1]) {
					sResponseBody += sHeader + ": " + aPartResponse[1][sHeader] + "\r\n";
				}
			}
			sResponseBody += "\r\n";

			if (aPartResponse[2]) {
				sResponseBody += aPartResponse[2];
			}
			sResponseBody += "\r\n";
		});

		// Check if we need to add the inner boundary again at the end
		if (sInnerBoundary) {
			sResponseBody += "--" + sInnerBoundary + "--\r\n";
		}
		// Add a final boundary to the batch response body
		sResponseBody += sOuterBoundary + "--";

		// Build the final batch response
		aResponse = [
			200,
			{
				"Content-Type" : "multipart/mixed;boundary=" + sOuterBoundary.slice(2),
				"OData-Version" : "4.0"
			},
			sResponseBody
		];

		return aResponse;
	}

	/**
	 * Handles any type of intercepted request and sends a fake response.
	 * Logs the request and response to the console.
	 * Manages batch requests.
	 * @param {Object} oXhr - the Sinon fake XMLHttpRequest
	 */
	function handleAllRequests(oXhr) {
		var aResponse;

		// Log the request
		jQuery.sap.log.info(
			"Mockserver: Received " + oXhr.method + " request to URL " + oXhr.url,
			oXhr.requestBody ? "Request body is:\n" + oXhr.requestBody : "No request body.");

		if (oXhr.method === "POST" && /\$batch$/.test(oXhr.url)) {
			aResponse = handleBatchRequest(oXhr);
		} else {
			aResponse = handleDirectRequest(oXhr);
		}

		oXhr.respond(aResponse[0], aResponse[1], aResponse[2]);

		// Log the response
		jQuery.sap.log.info(
			"Mockserver: Sent response with return code " + aResponse[0],
			"Response headers: " + JSON.stringify(aResponse[1]) + "\n\nResponse body:\n" + aResponse[2]);
	}

});
