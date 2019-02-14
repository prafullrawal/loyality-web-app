var apiUrl = location.protocol + '//' + location.host + "/api/";

//check user input and call server
$('.sign-in-partner').click(function() {

  //get user input data
  var formPartnerId = $('.partner-id input').val();
  var formCardId = $('.card-id input').val();

  //create json data
  var inputData = '{' + '"partnerid" : "' + formPartnerId + '", ' + '"cardid" : "' + formCardId + '"}';
  console.log(inputData);

  //make ajax call
  $.ajax({
    type: 'POST',
    url: apiUrl + 'partnerData',
    data: inputData,
    dataType: 'json',
    contentType: 'application/json',
    beforeSend: function() {
      //display loading
      document.getElementById('loader').style.display = "block";
    },
    success: function(data) {

      //remove loader
      document.getElementById('loader').style.display = "none";

      //check data for error
      if (data.error) {
        alert(data.error);
        return;
      } else {

        //update heading
        $('.heading').html(function() {
          var str = '<h2><b> ' + data.firstName + ' </b></h2>';
          str = str + '<h2><b> ' + data.partnerid + ' </b></h2>';

          return str;
        });

	var pointsGiven = 0;
	var pointsCollected = 0;	

        //update earn points transaction
        $('.points-allocated-transactions').html(function() {
          var str = '';
          var transactionData = data.pointsObj;
	  	
          for (var i = 0; i < transactionData.length; i++) {
	     if(transactionData[i].pointsTxType=="allocatePoints") {
                 pointsGiven = 	pointsGiven + parseInt(transactionData[i].points);	
           	 str = str + '<p>timeStamp: ' + transactionData[i].txTimestamp + '<br />partner: ' + transactionData[i].partnerid + '<br />member: ' + transactionData[i].accountNumber + '<br />points: ' + transactionData[i].points  + '<br />transactionID: ' + transactionData[i].txID + '</p><br>';
            }
	 }
          return str;
        });

        //update use points transaction
        $('.points-redeemed-transactions').html(function() {
          var str = '';
          var transactionData = data.pointsObj;

          for (var i = 0; i < transactionData.length; i++) {
            if(transactionData[i].pointsTxType=="redeemPoints") {
		 pointsCollected = pointsCollected + parseInt(transactionData[i].points);
                 str = str + '<p>timeStamp: ' + transactionData[i].txTimestamp + '<br />partner: ' + transactionData[i].partnerid + '<br />member: ' + transactionData[i].accountNumber + '<br />points: ' + transactionData[i].points  + '<br />transactionID: ' + transactionData[i].txID + '</p><br>';
            }
         }
	 return str;
        });

	//update dashboard
        $('.dashboards').html(function() {
          var str = '';
          str = str + '<h5>Total points allocated to customers: ' + pointsGiven + ' </h5>';
          str = str + '<h5>Total points redeemed by customers: ' + pointsCollected + ' </h5>';
          return str;
        });

        //remove login section
        document.getElementById('loginSection').style.display = "none";
        //display transaction section
        document.getElementById('transactionSection').style.display = "block";
      }

    },
    error: function(jqXHR, textStatus, errorThrown) {
      //reload on error
      alert("Error: Try again")
      console.log(errorThrown);
      console.log(textStatus);
      console.log(jqXHR);

      location.reload();
    }
  });

});
