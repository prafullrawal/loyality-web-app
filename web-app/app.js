'use strict';

//get libraries
const express = require('express');
const bodyParser = require('body-parser');
const request = require('request');
const path = require('path')

//create express web-app
const app = express();
const router = express.Router();


// getting fabric lib
var Fabric_Client = require('fabric-client');
//var path = require('path');
var util = require('util');
var os = require('os');

//get the libraries to call
var network = require('./network/network.js');
var validate = require('./network/validate.js');
var analysis = require('./network/analysis.js');

//bootstrap application settings
app.use(express.static('./public'));
app.use('/scripts', express.static(path.join(__dirname, '/public/scripts')));
app.use(bodyParser.json());

//get home page
app.get('/home', function(req, res) {
  res.sendFile(path.join(__dirname + '/public/index.html'));
});

//get member page
app.get('/member', function(req, res) {
  res.sendFile(path.join(__dirname + '/public/member.html'));
});

//get member registration page
app.get('/registerMember', function(req, res) {
  res.sendFile(path.join(__dirname + '/public/registerMember.html'));
});

//get partner page
app.get('/partner', function(req, res) {
  res.sendFile(path.join(__dirname + '/public/partner.html'));
});

//get partner registration page
app.get('/registerPartner', function(req, res) {
  res.sendFile(path.join(__dirname + '/public/registerPartner.html'));
});

//get about page
app.get('/about', function(req, res) {
  res.sendFile(path.join(__dirname + '/public/about.html'));
});


//post call to register member on the network
app.post('/api/registerMember', function(req, res) {

  //declare variables to retrieve from request
  var accountNumber = req.body.accountnumber;
  var cardId = req.body.cardid;
  var firstName = req.body.firstname;
  var lastName = req.body.lastname;
  var email = req.body.email;
  var phoneNumber = req.body.phonenumber;

  //print variables
  console.log('Using param - firstname: ' + firstName + ' lastname: ' + lastName + ' email: ' + email + ' phonenumber: ' + phoneNumber + ' accountNumber: ' + accountNumber + ' cardId: ' + cardId);

  //validate member registration fields
  validate.validateMemberRegistration(cardId, accountNumber, firstName, lastName, email, phoneNumber)
    .then((response) => {
      //return error if error in response
      if (response.error != null) {
        res.json({
          error: response.error
        });
        return;
      } else {
        //else register member on the network
       
      var fabric_client = new Fabric_Client();

      // setup the fabric network
      var channel = fabric_client.newChannel('mychannel');
      var peer = fabric_client.newPeer('grpc://localhost:7051');
      channel.addPeer(peer);
      var order = fabric_client.newOrderer('grpc://localhost:7050')
      channel.addOrderer(order);

      var member_user = null;
      var store_path = path.join(__dirname, 'hfc-key-store');
      console.log('Store path:'+store_path);
      var tx_id = null;

      // create the key value store as defined in the fabric-client/config/default.json 'key-value-store' setting
      Fabric_Client.newDefaultKeyValueStore({ path: store_path
      }).then((state_store) => {
              // assign the store to the fabric client
              fabric_client.setStateStore(state_store);
              var crypto_suite = Fabric_Client.newCryptoSuite();
              // use the same location for the state store (where the users' certificate are kept)
              // and the crypto store (where the users' keys are kept)
              var crypto_store = Fabric_Client.newCryptoKeyStore({path: store_path});
              crypto_suite.setCryptoKeyStore(crypto_store);
              fabric_client.setCryptoSuite(crypto_suite);

              // get the enrolled user from persistence, this user will sign all requests
              return fabric_client.getUserContext('user1', true);
      }).then((user_from_store) => {
              if (user_from_store && user_from_store.isEnrolled()) {
                      console.log('Successfully loaded user1 from persistence');
                      member_user = user_from_store;
              } else {
                      throw new Error('Failed to get user1.... run registerUser.js');
              }

              // get a transaction id object based on the current user assigned to fabric client
              tx_id = fabric_client.newTransactionID();
              console.log("Assigning transaction_id: ", tx_id._transaction_id);

              // createCar chaincode function - requires 5 args, ex: args: ['CAR12', 'Honda', 'Accord', 'Black', 'Tom'],
              // changeCarOwner chaincode function - requires 2 args , ex: args: ['CAR10', 'Dave'],
              // must send the proposal to endorsing peers
              var request = {
                      //targets: let default to the peer assigned to the client
                      chaincodeId: 'loyality',
                      fcn: 'addMember',
                      args: [accountNumber,firstName,lastName,phoneNumber,email],
                      chainId: 'mychannel',
                      txId: tx_id
              };

              // send the transaction proposal to the peers
              return channel.sendTransactionProposal(request);
      }).then((results) => {
              var proposalResponses = results[0];
              var proposal = results[1];
              let isProposalGood = false;
              if (proposalResponses && proposalResponses[0].response &&
                      proposalResponses[0].response.status === 200) {
                              isProposalGood = true;
                              console.log('Transaction proposal was good');
                      } else {
                              console.error('Transaction proposal was bad');
                      }
              if (isProposalGood) {
                      console.log(util.format(
                              'Successfully sent Proposal and received ProposalResponse: Status - %s, message - "%s"',
                              proposalResponses[0].response.status, proposalResponses[0].response.message));

                      // build up the request for the orderer to have the transaction committed
                      var request = {
                              proposalResponses: proposalResponses,
                              proposal: proposal
                      };

                      // set the transaction listener and set a timeout of 30 sec
                      // if the transaction did not get committed within the timeout period,
                      // report a TIMEOUT status
                      var transaction_id_string = tx_id.getTransactionID(); //Get the transaction ID string to be used by the event processing
                      var promises = [];

                      var sendPromise = channel.sendTransaction(request);
                      promises.push(sendPromise); //we want the send transaction first, so that we know where to check status

                      // get an eventhub once the fabric client has a user assigned. The user
                      // is required bacause the event registration must be signed
                      let event_hub = channel.newChannelEventHub(peer);

                      // using resolve the promise so that result status may be processed
                      // under the then clause rather than having the catch clause process
                      // the status
                      let txPromise = new Promise((resolve, reject) => {
                              let handle = setTimeout(() => {
                                      event_hub.unregisterTxEvent(transaction_id_string);
                                      event_hub.disconnect();
                                      resolve({event_status : 'TIMEOUT'}); //we could use reject(new Error('Trnasaction did not complete within 30 seconds'));
                              }, 3000);
                              event_hub.registerTxEvent(transaction_id_string, (tx, code) => {
                                      // this is the callback for transaction event status
                                      // first some clean up of event listener
                                      clearTimeout(handle);

                                      // now let the application know what happened
                                      var return_status = {event_status : code, tx_id : transaction_id_string};
                                      if (code !== 'VALID') {
                                              console.error('The transaction was invalid, code = ' + code);
                                              resolve(return_status); // we could use reject(new Error('Problem with the tranaction, event status ::'+code));
                                      } else {
                                              console.log('The transaction has been committed on peer ' + event_hub.getPeerAddr());
                                              resolve(return_status);
                                      }
                              }, (err) => {
                                      //this is the callback if something goes wrong with the event registration or processing
                                      reject(new Error('There was a problem with the eventhub ::'+err));
                              },
                                      {disconnect: true} //disconnect when complete
                              );
                              event_hub.connect();

                      });
                      promises.push(txPromise);

                      return Promise.all(promises);
              } else {
                      console.error('Failed to send Proposal or receive valid response. Response null or status is not 200. exiting...');
                      throw new Error('Failed to send Proposal or receive valid response. Response null or status is not 200. exiting...');
              }
      }).then((results) => {
              console.log('Send transaction promise and event listener promise have completed');
              // check the results in the order the promises were added to the promise all list
              if (results && results[0] && results[0].status === 'SUCCESS') {
                      console.log('Successfully sent transaction to the orderer.');
              } else {
                      console.error('Failed to order the transaction. Error code: ' + results[0].status);
              }

              if(results && results[1] && results[1].event_status === 'VALID') {
                      console.log('Successfully committed the change to the ledger by the peer');
		      var data = {}
                      data.txid = tx_id.getTransactionID();
                      data.error = null;     
                      res.send(data);
              } else {
                      console.log('Transaction failed to be committed to the ledger due to ::'+results[1].event_status);	
              }
      }).catch((err) => {
              console.error('Failed to invoke successfully :: ' + err);
	      var data = {};
              data.error = err ;     
              res.send(data)  ;
      });


      }
    });


});

//post call to register partner on the network
app.post('/api/registerPartner', function(req, res) {

  //declare variables to retrieve from request
  var name = req.body.name;
  var partnerId = req.body.partnerid;
  var cardId = req.body.cardid;

  //print variables
  console.log('Using param - name: ' + name + ' partnerId: ' + partnerId + ' cardId: ' + cardId);

  //validate partner registration fields
  validate.validatePartnerRegistration(cardId, partnerId, name)
    .then((response) => {
      //return error if error in response
      if (response.error != null) {
        res.json({
          error: response.error
        });
        return;
      } else {
        //else register partner on the network
 
	var fabric_client = new Fabric_Client();

        // setup the fabric network
        var channel = fabric_client.newChannel('mychannel');
        var peer = fabric_client.newPeer('grpc://localhost:7051');
        channel.addPeer(peer);
        var order = fabric_client.newOrderer('grpc://localhost:7050')
        channel.addOrderer(order);

        var member_user = null;
        var store_path = path.join(__dirname, 'hfc-key-store');
        console.log('Store path:'+store_path);
        var tx_id = null;

        // create the key value store as defined in the fabric-client/config/default.json 'key-value-store' setting
        Fabric_Client.newDefaultKeyValueStore({ path: store_path
        }).then((state_store) => {
                // assign the store to the fabric client
                fabric_client.setStateStore(state_store);
                var crypto_suite = Fabric_Client.newCryptoSuite();
                // use the same location for the state store (where the users' certificate are kept)
                // and the crypto store (where the users' keys are kept)
                var crypto_store = Fabric_Client.newCryptoKeyStore({path: store_path});
                crypto_suite.setCryptoKeyStore(crypto_store);
                fabric_client.setCryptoSuite(crypto_suite);

                // get the enrolled user from persistence, this user will sign all requests
                return fabric_client.getUserContext('user1', true);
        }).then((user_from_store) => {
                if (user_from_store && user_from_store.isEnrolled()) {
                        console.log('Successfully loaded user1 from persistence');
                        member_user = user_from_store;
                } else {
                        throw new Error('Failed to get user1.... run registerUser.js');
                }

                // get a transaction id object based on the current user assigned to fabric client
                tx_id = fabric_client.newTransactionID();
                console.log("Assigning transaction_id: ", tx_id._transaction_id);

                // createCar chaincode function - requires 5 args, ex: args: ['CAR12', 'Honda', 'Accord', 'Black', 'Tom'],
                // changeCarOwner chaincode function - requires 2 args , ex: args: ['CAR10', 'Dave'],
                // must send the proposal to endorsing peers
                var request = {
                        //targets: let default to the peer assigned to the client
                        chaincodeId: 'loyality',
                        fcn: 'addPartner',
                        args: [partnerId,name],
                        chainId: 'mychannel',
                        txId: tx_id
                };

                // send the transaction proposal to the peers
                return channel.sendTransactionProposal(request);
        }).then((results) => {
                var proposalResponses = results[0];
                var proposal = results[1];
                let isProposalGood = false;
                if (proposalResponses && proposalResponses[0].response &&
                        proposalResponses[0].response.status === 200) {
                                isProposalGood = true;
                                console.log('Transaction proposal was good');
                        } else {
                                console.error('Transaction proposal was bad');
                        }
                if (isProposalGood) {
                        console.log(util.format(
                                'Successfully sent Proposal and received ProposalResponse: Status - %s, message - "%s"',
                                proposalResponses[0].response.status, proposalResponses[0].response.message));

                        // build up the request for the orderer to have the transaction committed
                        var request = {
                                proposalResponses: proposalResponses,
                                proposal: proposal
                        };

                        // set the transaction listener and set a timeout of 30 sec
                        // if the transaction did not get committed within the timeout period,
                        // report a TIMEOUT status
                        var transaction_id_string = tx_id.getTransactionID(); //Get the transaction ID string to be used by the event processing
                        var promises = [];

                        var sendPromise = channel.sendTransaction(request);
                        promises.push(sendPromise); //we want the send transaction first, so that we know where to check status

                        // get an eventhub once the fabric client has a user assigned. The user
                        // is required bacause the event registration must be signed
                        let event_hub = channel.newChannelEventHub(peer);

                        // using resolve the promise so that result status may be processed
                        // under the then clause rather than having the catch clause process
                        // the status
                        let txPromise = new Promise((resolve, reject) => {
                                let handle = setTimeout(() => {
                                        event_hub.unregisterTxEvent(transaction_id_string);
                                        event_hub.disconnect();
                                        resolve({event_status : 'TIMEOUT'}); //we could use reject(new Error('Trnasaction did not complete within 30 seconds'));
                                }, 3000);
                                event_hub.registerTxEvent(transaction_id_string, (tx, code) => {
                                        // this is the callback for transaction event status
                                        // first some clean up of event listener
                                        clearTimeout(handle);

                                        // now let the application know what happened
                                        var return_status = {event_status : code, tx_id : transaction_id_string};
                                        if (code !== 'VALID') {
                                                console.error('The transaction was invalid, code = ' + code);
                                                resolve(return_status); // we could use reject(new Error('Problem with the tranaction, event status ::'+code));
                                        } else {
                                                console.log('The transaction has been committed on peer ' + event_hub.getPeerAddr());
                                                resolve(return_status);
                                        }
                                }, (err) => {
                                        //this is the callback if something goes wrong with the event registration or processing
                                        reject(new Error('There was a problem with the eventhub ::'+err));
                                },
                                        {disconnect: true} //disconnect when complete
                                );
                                event_hub.connect();

                        });
                        promises.push(txPromise);

                        return Promise.all(promises);
                } else {
                        console.error('Failed to send Proposal or receive valid response. Response null or status is not 200. exiting...');
                        throw new Error('Failed to send Proposal or receive valid response. Response null or status is not 200. exiting...');
                }
        }).then((results) => {
                console.log('Send transaction promise and event listener promise have completed');
                // check the results in the order the promises were added to the promise all list
                if (results && results[0] && results[0].status === 'SUCCESS') {
                        console.log('Successfully sent transaction to the orderer.');
                } else {
                        console.error('Failed to order the transaction. Error code: ' + results[0].status);
                }

                if(results && results[1] && results[1].event_status === 'VALID') {
                        console.log('Successfully committed the change to the ledger by the peer');
			var data = {}
                        data.txid = tx_id.getTransactionID();
                        data.error = null;     
                        res.send(data);	
                
                } else {
                        console.log('Transaction failed to be committed to the ledger due to ::'+results[1].event_status);
                }
        }).catch((err) => {
                console.error('Failed to invoke successfully :: ' + err);
		var data = {};
                data.error = err ;     
                res.send(data) ;
        });



      }
    });

});


//post call to receive all partners
app.post('/api/allPartnerData', function(req, res) {

	            var fabric_client = new Fabric_Client();
            // setup the fabric network
            var channel = fabric_client.newChannel('mychannel');
            var peer = fabric_client.newPeer('grpc://localhost:7051');
            channel.addPeer(peer);
            var member_user = null;
            var store_path = path.join(__dirname, 'hfc-key-store');
            console.log('Store path:'+store_path);
            var tx_id = null;

            // create the key value store as defined in the fabric-client/config/default.json 'key-value-store' setting
            Fabric_Client.newDefaultKeyValueStore({ path: store_path
            }).then((state_store) => {
                    // assign the store to the fabric client
                    fabric_client.setStateStore(state_store);
                    var crypto_suite = Fabric_Client.newCryptoSuite();
                    // use the same location for the state store (where the users' certificate are kept)
                    // and the crypto store (where the users' keys are kept)
                    var crypto_store = Fabric_Client.newCryptoKeyStore({path: store_path});
                    crypto_suite.setCryptoKeyStore(crypto_store);
                    fabric_client.setCryptoSuite(crypto_suite);

                    // get the enrolled user from persistence, this user will sign all requests
                    return fabric_client.getUserContext('user1', true);
            }).then((user_from_store) => {
                    if (user_from_store && user_from_store.isEnrolled()) {
                            console.log('Successfully loaded user1 from persistence');
                            member_user = user_from_store;
                    } else {
                            throw new Error('Failed to get user1.... run registerUser.js');
                    }

                    // tx_id = fabric_client.newTransactionID();
                    //  console.log("Assigning transaction_id: ", tx_id._transaction_id);

                    // queryCar chaincode function - requires 1 argument, ex: args: ['CAR4'],
                    // queryAllCars chaincode function - requires no arguments , ex: args: [''],
                    const request = {
                            //targets : --- letting this default to the peers assigned to the channel
                            chaincodeId: 'loyality',
                            fcn: 'getAllPartnerRecord',
                            args: ['']
                    };

                    // send the query proposal to the peer
                    return channel.queryByChaincode(request);
            }).then((query_responses) => {
                    console.log("Query has completed, checking results");
                    // query_responses could have more than one  results if there multiple peers were used as targets
                    if (query_responses && query_responses.length == 1) {
                            if (query_responses[0] instanceof Error) {
                                    console.error("error from query = ", query_responses[0]);
                            } else {
                                    console.log("Response is ", query_responses[0].toString());
				    query_responses[0].error = null ;
				    res.send(query_responses[0]);
				    console.log("Response sent success") 			
                            }
                    } else {
                            console.log("No payloads were returned from query");
                    }
            }).catch((err) => {
                    console.error('Failed to query successfully :: ' + err);
            });

});

//post call to perform EarnPoints transaction on the network
app.post('/api/earnPoints', function(req, res) {

  //declare variables to retrieve from request
  var accountNumber = req.body.accountnumber;
  var cardId = req.body.cardid;
  var partnerId = req.body.partnerid;
  var points = parseFloat(req.body.points);

  //print variables
  console.log('Using param - points: ' + points + ' partnerId: ' + partnerId + ' accountNumber: ' + accountNumber + ' cardId: ' + cardId);

  //validate points field
  validate.validatePoints(points)
    .then((checkPoints) => {
      //return error if error in response
      if (checkPoints.error != null) {
        res.json({
          error: checkPoints.error
        });
        return;
      } else {
        points = checkPoints;
	points = points.toString(); 
        //else perforn EarnPoints transaction on the network
	
	var fabric_client = new Fabric_Client();
        // setup the fabric network
        var channel = fabric_client.newChannel('mychannel');
        var peer = fabric_client.newPeer('grpc://localhost:7051');
        channel.addPeer(peer);
        var order = fabric_client.newOrderer('grpc://localhost:7050')
        channel.addOrderer(order);

        var member_user = null;
        var store_path = path.join(__dirname, 'hfc-key-store');
        console.log('Store path:'+store_path);
        var tx_id = null;

        // create the key value store as defined in the fabric-client/config/default.json 'key-value-store' setting
        Fabric_Client.newDefaultKeyValueStore({ path: store_path
        }).then((state_store) => {
                // assign the store to the fabric client
                fabric_client.setStateStore(state_store);
                var crypto_suite = Fabric_Client.newCryptoSuite();
                // use the same location for the state store (where the users' certificate are kept)
                // and the crypto store (where the users' keys are kept)
                var crypto_store = Fabric_Client.newCryptoKeyStore({path: store_path});
                crypto_suite.setCryptoKeyStore(crypto_store);
                fabric_client.setCryptoSuite(crypto_suite);

                // get the enrolled user from persistence, this user will sign all requests
                return fabric_client.getUserContext('user1', true);
        }).then((user_from_store) => {
                if (user_from_store && user_from_store.isEnrolled()) {
                        console.log('Successfully loaded user1 from persistence');
                        member_user = user_from_store;
                } else {
                        throw new Error('Failed to get user1.... run registerUser.js');
                }

                // get a transaction id object based on the current user assigned to fabric client
                tx_id = fabric_client.newTransactionID();
                console.log("Assigning transaction_id: ", tx_id._transaction_id);

                // createCar chaincode function - requires 5 args, ex: args: ['CAR12', 'Honda', 'Accord', 'Black', 'Tom'],
                // changeCarOwner chaincode function - requires 2 args , ex: args: ['CAR10', 'Dave'],
                // must send the proposal to endorsing peers
                var request = {
                        //targets: let default to the peer assigned to the client
                        chaincodeId: 'loyality',
                        fcn: 'earnPoints',
                        args: [accountNumber,points,partnerId],
                        chainId: 'mychannel',
                        txId: tx_id
                };

                // send the transaction proposal to the peers
                return channel.sendTransactionProposal(request);
        }).then((results) => {
                var proposalResponses = results[0];
                var proposal = results[1];
                let isProposalGood = false;
                if (proposalResponses && proposalResponses[0].response &&
                        proposalResponses[0].response.status === 200) {
                                isProposalGood = true;
                                console.log('Transaction proposal was good');
                        } else {
                                console.error('Transaction proposal was bad');
                        }
                if (isProposalGood) {
                        console.log(util.format(
                                'Successfully sent Proposal and received ProposalResponse: Status - %s, message - "%s"',
                                proposalResponses[0].response.status, proposalResponses[0].response.message));

                        // build up the request for the orderer to have the transaction committed
                        var request = {
                                proposalResponses: proposalResponses,
                                proposal: proposal
                        };

                        // set the transaction listener and set a timeout of 30 sec
                        // if the transaction did not get committed within the timeout period,
                        // report a TIMEOUT status
                        var transaction_id_string = tx_id.getTransactionID(); //Get the transaction ID string to be used by the event processing
                        var promises = [];

                        var sendPromise = channel.sendTransaction(request);
                        promises.push(sendPromise); //we want the send transaction first, so that we know where to check status

                        // get an eventhub once the fabric client has a user assigned. The user
                        // is required bacause the event registration must be signed
                        let event_hub = channel.newChannelEventHub(peer);

                        // using resolve the promise so that result status may be processed
                        // under the then clause rather than having the catch clause process
                        // the status
                        let txPromise = new Promise((resolve, reject) => {
                                let handle = setTimeout(() => {
                                        event_hub.unregisterTxEvent(transaction_id_string);
                                        event_hub.disconnect();
                                        resolve({event_status : 'TIMEOUT'}); //we could use reject(new Error('Trnasaction did not complete within 30 seconds'));
                                }, 3000);
                                event_hub.registerTxEvent(transaction_id_string, (tx, code) => {
                                        // this is the callback for transaction event status
                                        // first some clean up of event listener
                                        clearTimeout(handle);

                                        // now let the application know what happened
                                        var return_status = {event_status : code, tx_id : transaction_id_string};
                                        if (code !== 'VALID') {
                                                console.error('The transaction was invalid, code = ' + code);
                                                resolve(return_status); // we could use reject(new Error('Problem with the tranaction, event status ::'+code));
                                        } else {
                                                console.log('The transaction has been committed on peer ' + event_hub.getPeerAddr());
                                                resolve(return_status);
                                        }
                                }, (err) => {
                                        //this is the callback if something goes wrong with the event registration or processing
                                        reject(new Error('There was a problem with the eventhub ::'+err));
                                },
                                        {disconnect: true} //disconnect when complete
                                );
                                event_hub.connect();

                        });
                        promises.push(txPromise);

                        return Promise.all(promises);
                } else {
                        console.error('Failed to send Proposal or receive valid response. Response null or status is not 200. exiting...');
                        throw new Error('Failed to send Proposal or receive valid response. Response null or status is not 200. exiting...');
                }
        }).then((results) => {
                console.log('Send transaction promise and event listener promise have completed');
                // check the results in the order the promises were added to the promise all list
                if (results && results[0] && results[0].status === 'SUCCESS') {
                        console.log('Successfully sent transaction to the orderer.');
                } else {
                        console.error('Failed to order the transaction. Error code: ' + results[0].status);
                }

                if(results && results[1] && results[1].event_status === 'VALID') {
                        console.log('Successfully committed the change to the ledger by the peer');
                        var data = {}
                        data.txid = tx_id.getTransactionID();
                        data.error = null ;     
                        res.send(data);

                } else {
                        console.log('Transaction failed to be committed to the ledger due to ::'+results[1].event_status);
                }
        }).catch((err) => {
                console.error('Failed to invoke successfully :: ' + err);
		var data = {}
                data.error = err ;
                res.send(data);
        });        

      }
    });

});

//post call to perform UsePoints transaction on the network
app.post('/api/usePoints', function(req, res) {

  //declare variables to retrieve from request
  var accountNumber = req.body.accountnumber;
  var cardId = req.body.cardid;
  var partnerId = req.body.partnerid;
  var points = parseFloat(req.body.points);

  //print variables
  console.log('Using param - points: ' + points + ' partnerId: ' + partnerId + ' accountNumber: ' + accountNumber + ' cardId: ' + cardId);

  //validate points field
  validate.validatePoints(points)
    //return error if error in response
    .then((checkPoints) => {
      if (checkPoints.error != null) {
        res.json({
          error: checkPoints.error
        });
        return;
      } else {
        points = checkPoints.toString();
        //else perforn UsePoints transaction on the network
			
		
	var fabric_client = new Fabric_Client();
        // setup the fabric network
        var channel = fabric_client.newChannel('mychannel');
        var peer = fabric_client.newPeer('grpc://localhost:7051');
        channel.addPeer(peer);
        var order = fabric_client.newOrderer('grpc://localhost:7050')
        channel.addOrderer(order);

        var member_user = null;
        var store_path = path.join(__dirname, 'hfc-key-store');
        console.log('Store path:'+store_path);
        var tx_id = null;

        // create the key value store as defined in the fabric-client/config/default.json 'key-value-store' setting
        Fabric_Client.newDefaultKeyValueStore({ path: store_path
        }).then((state_store) => {
                // assign the store to the fabric client
                fabric_client.setStateStore(state_store);
                var crypto_suite = Fabric_Client.newCryptoSuite();
                // use the same location for the state store (where the users' certificate are kept)
                // and the crypto store (where the users' keys are kept)
                var crypto_store = Fabric_Client.newCryptoKeyStore({path: store_path});
                crypto_suite.setCryptoKeyStore(crypto_store);
                fabric_client.setCryptoSuite(crypto_suite);

                // get the enrolled user from persistence, this user will sign all requests
                return fabric_client.getUserContext('user1', true);
        }).then((user_from_store) => {
                if (user_from_store && user_from_store.isEnrolled()) {
                        console.log('Successfully loaded user1 from persistence');
                        member_user = user_from_store;
                } else {
                        throw new Error('Failed to get user1.... run registerUser.js');
                }

                // get a transaction id object based on the current user assigned to fabric client
                tx_id = fabric_client.newTransactionID();
                console.log("Assigning transaction_id: ", tx_id._transaction_id);

                // createCar chaincode function - requires 5 args, ex: args: ['CAR12', 'Honda', 'Accord', 'Black', 'Tom'],
                // changeCarOwner chaincode function - requires 2 args , ex: args: ['CAR10', 'Dave'],
                // must send the proposal to endorsing peers
                var request = {
                        //targets: let default to the peer assigned to the client
                        chaincodeId: 'loyality',
                        fcn: 'usePoints',
                        args: [accountNumber,points,partnerId],
                        chainId: 'mychannel',
                        txId: tx_id
                };

                // send the transaction proposal to the peers
                return channel.sendTransactionProposal(request);
        }).then((results) => {
                var proposalResponses = results[0];
                var proposal = results[1];
                let isProposalGood = false;
                if (proposalResponses && proposalResponses[0].response &&
                        proposalResponses[0].response.status === 200) {
                                isProposalGood = true;
                                console.log('Transaction proposal was good');
                        } else {
                                console.error('Transaction proposal was bad');
                        }
                if (isProposalGood) {
                        console.log(util.format(
                                'Successfully sent Proposal and received ProposalResponse: Status - %s, message - "%s"',
                                proposalResponses[0].response.status, proposalResponses[0].response.message));

                        // build up the request for the orderer to have the transaction committed
                        var request = {
                                proposalResponses: proposalResponses,
                                proposal: proposal
                        };

                        // set the transaction listener and set a timeout of 30 sec
                        // if the transaction did not get committed within the timeout period,
                        // report a TIMEOUT status
                        var transaction_id_string = tx_id.getTransactionID(); //Get the transaction ID string to be used by the event processing
                        var promises = [];

                        var sendPromise = channel.sendTransaction(request);
                        promises.push(sendPromise); //we want the send transaction first, so that we know where to check status

                        // get an eventhub once the fabric client has a user assigned. The user
                        // is required bacause the event registration must be signed
                        let event_hub = channel.newChannelEventHub(peer);

                        // using resolve the promise so that result status may be processed
                        // under the then clause rather than having the catch clause process
                        // the status
                        let txPromise = new Promise((resolve, reject) => {
                                let handle = setTimeout(() => {
                                        event_hub.unregisterTxEvent(transaction_id_string);
                                        event_hub.disconnect();
                                        resolve({event_status : 'TIMEOUT'}); //we could use reject(new Error('Trnasaction did not complete within 30 seconds'));
                                }, 3000);
                                event_hub.registerTxEvent(transaction_id_string, (tx, code) => {
                                        //   this is the callback for transaction event status
                                        // first some clean up of event listener
                                        clearTimeout(handle);

                                        // now let the application know what happened
                                        var return_status = {event_status : code, tx_id : transaction_id_string};
                                        if (code !== 'VALID') {
                                                console.error('The transaction was invalid, code = ' + code);
                                                resolve(return_status); // we could use reject(new Error('Problem with the tranaction, event status ::'+code));
                                        } else {
                                                console.log('The transaction has been committed on peer ' + event_hub.getPeerAddr());
                                                resolve(return_status);
                                        }
                                }, (err) => {
                                        //this is the callback if something goes wrong with the event registration or processing
                                        reject(new Error('There was a problem with the eventhub ::'+err));
                                },
                                        {disconnect: true} //disconnect when complete
                                );
                                event_hub.connect();

                        });
                        promises.push(txPromise);

                        return Promise.all(promises);
                } else {
                        console.error('Failed to send Proposal or receive valid response. Response null or status is not 200. exiting...');
                        throw new Error('Failed to send Proposal or receive valid response. Response null or status is not 200. exiting...');
                }
        }).then((results) => {
                console.log('Send transaction promise and event listener promise have completed');
                // check the results in the order the promises were added to the promise all list
                if (results && results[0] && results[0].status === 'SUCCESS') {
                        console.log('Successfully sent transaction to the orderer.');
                } else {
                        console.error('Failed to order the transaction. Error code: ' + results[0].status);
                }

                if(results && results[1] && results[1].event_status === 'VALID') {
                        console.log('Successfully committed the change to the ledger by the peer');
                        var data = {}
                        data.txid = tx_id.getTransactionID();
                        data.error = null ;     
                        res.send(data)  ;

                } else {
                        console.log('Transaction failed to be committed to the ledger due to ::'+results[1].event_status);
                }
        }).catch((err) => {
                console.error('Failed to invoke successfully :: ' + err);
                var data = {};
                data.error = err ;     
                res.send(data)  ;
        });
		
      }
    });


});

//post call to retrieve member data, transactions data and partners to perform transactions with from the network
app.post('/api/memberData', function(req, res) {

  //declare variables to retrieve from request
  var accountNumber = req.body.accountnumber;
  var cardId = req.body.cardid;

  	    var fabric_client = new Fabric_Client();
            // setup the fabric network
            var channel = fabric_client.newChannel('mychannel');
            var peer = fabric_client.newPeer('grpc://localhost:7051');
            channel.addPeer(peer);
            var member_user = null;
            var store_path = path.join(__dirname, 'hfc-key-store');
            console.log('Store path:'+store_path);
            var tx_id = null;

            // create the key value store as defined in the fabric-client/config/default.json 'key-value-store' setting
            Fabric_Client.newDefaultKeyValueStore({ path: store_path
            }).then((state_store) => {
                    // assign the store to the fabric client
                    fabric_client.setStateStore(state_store);
                    var crypto_suite = Fabric_Client.newCryptoSuite();
                    // use the same location for the state store (where the users' certificate are kept)
                    // and the crypto store (where the users' keys are kept)
                    var crypto_store = Fabric_Client.newCryptoKeyStore({path: store_path});
                    crypto_suite.setCryptoKeyStore(crypto_store);
                    fabric_client.setCryptoSuite(crypto_suite);

                    // get the enrolled user from persistence, this user will sign all requests
                    return fabric_client.getUserContext('user1', true);
            }).then((user_from_store) => {
                    if (user_from_store && user_from_store.isEnrolled()) {
                            console.log('Successfully loaded user1 from persistence');
                            member_user = user_from_store;
                    } else {
                            throw new Error('Failed to get user1.... run registerUser.js');
                    }
                    tx_id = fabric_client.newTransactionID();
                    console.log("Assigning transaction_id: ", tx_id._transaction_id);

                    const request = {
                            //targets : --- letting this default to the peers assigned to the channel
                            chaincodeId: 'loyality',
                            fcn: 'getMemberRecord',
                            args: [accountNumber]
                    };

                    // send the query proposal to the peer
                    return channel.queryByChaincode(request);

            }).then((query_responses) => {
                    console.log("Query has completed, checking results");
                    // query_responses could have more than one  results if there multiple peers were used as targets
                    if (query_responses && query_responses.length == 1) {
                            if (query_responses[0] instanceof Error) {
                                    console.error("error from query = ", query_responses[0]);
                            } else {
                                    console.log("Response is ", query_responses[0].toString());
                                    query_responses[0].error = null;
                                    res.send(query_responses[0]);
                            }
                    } else {
                            console.log("No payloads were returned from query");
                    }
            }).catch((err) => {
                    console.error('Failed to query successfully :: ' + err);
            });
 

});

//post call to retrieve partner data and transactions data from the network
app.post('/api/partnerData', function(req, res) {

  //declare variables to retrieve from request
  var partnerId = req.body.partnerid;
  var cardId = req.body.cardid;

  //print variables
  console.log('partnerData using param - ' + ' partnerId: ' + partnerId + ' cardId: ' + cardId);
	  
	     var fabric_client = new Fabric_Client();
            // setup the fabric network
            var channel = fabric_client.newChannel('mychannel');
            var peer = fabric_client.newPeer('grpc://localhost:7051');
            channel.addPeer(peer);
            var member_user = null;
            var store_path = path.join(__dirname, 'hfc-key-store');
            console.log('Store path:'+store_path);
            var tx_id = null;

            // create the key value store as defined in the fabric-client/config/default.json 'key-value-store' setting
            Fabric_Client.newDefaultKeyValueStore({ path: store_path
            }).then((state_store) => {
                    // assign the store to the fabric client
                    fabric_client.setStateStore(state_store);
                    var crypto_suite = Fabric_Client.newCryptoSuite();
                    // use the same location for the state store (where the users' certificate are kept)
                    // and the crypto store (where the users' keys are kept)
                    var crypto_store = Fabric_Client.newCryptoKeyStore({path: store_path});
                    crypto_suite.setCryptoKeyStore(crypto_store);
                    fabric_client.setCryptoSuite(crypto_suite);

                    // get the enrolled user from persistence, this user will sign all requests
                    return fabric_client.getUserContext('user1', true);
            }).then((user_from_store) => {
                    if (user_from_store && user_from_store.isEnrolled()) {
                            console.log('Successfully loaded user1 from persistence');
                            member_user = user_from_store;
                    } else {
                            throw new Error('Failed to get user1.... run registerUser.js');
                    }
                    tx_id = fabric_client.newTransactionID();
                    console.log("Assigning transaction_id: ", tx_id._transaction_id);

                    const request = {
                            //targets : --- letting this default to the peers assigned to the channel
                            chaincodeId: 'loyality',
                            fcn: 'getPartnerRecord',
                            args: [partnerId]
                    };

                    // send the query proposal to the peer
                    return channel.queryByChaincode(request);

            }).then((query_responses) => {
                    console.log("Query has completed, checking results");
                    // query_responses could have more than one  results if there multiple peers were used as targets
                    if (query_responses && query_responses.length == 1) {
                            if (query_responses[0] instanceof Error) {
                                    console.error("error from query = ", query_responses[0]);
                            } else {
                                    console.log("Response is ", query_responses[0].toString());
                                    query_responses[0].error = null;
                                    res.send(query_responses[0]);
                            }
                    } else {
                            console.log("No payloads were returned from query");
                    }
            }).catch((err) => {
                    console.error('Failed to query successfully :: ' + err);
            });


});

//declare port
var port = process.env.PORT || 8000;
if (process.env.VCAP_APPLICATION) {
  port = process.env.PORT;
}

//run app on port
app.listen(port, function() {
  console.log('app running on port: %d', port);
});
