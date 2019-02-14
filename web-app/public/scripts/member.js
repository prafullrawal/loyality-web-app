var apiUrl = location.protocol + '//' + location.host + "/api/";

//check user input and call server
$('.sign-in-member').click(function() {
  updateMember();
});

function updateMember() {

  //get user input data
  var formAccountNum = $('.account-number input').val();
  var formCardId = "user1"; //  $('.card-id input').val();

  //create json data
  var inputData = '{' + '"accountnumber" : "' + formAccountNum + '", ' + '"cardid" : "' + formCardId + '"}';
  console.log(inputData)

  //make ajax call for memberData 
  $.ajax({
    type: 'POST',
    url: apiUrl + 'memberData',
    data: inputData,
    dataType: 'json',
    contentType: 'application/json',
    beforeSend: function() {
      //display loading
      document.getElementById('loader').style.display = "block";
    },
    success: function(data) {	
      
      //check data for error
      if (data.error) {
        alert(data.error);
        return;
      } else {

        var pointBalance =0;
        var earnPoint = 0 ;
        var redeemPoint = 0;

        //update earn points transaction
        $('.points-allocated-transactions').html(function() {
          var str = '';
          var transactionData = data.pointsObj;

          for (var i = 0; i <  transactionData.length; i++) {
              if(transactionData[i].pointsTxType=="earnPoints"){
              earnPoint = earnPoint+ parseInt(transactionData[i].points);  
              str = str + '<p>timeStamp: ' + transactionData[i].txTimestamp+ '<br />partner: ' + transactionData[i].partnerid+ '<br />member: ' + transactionData[i].accountNumber + '<br />points: ' + transactionData[i].points + '<br />transactionID: ' +transactionData[i].txID + '</p><br>';
            }
         }	  
	 return str;
          
        });

        //update use points transaction
        $('.points-redeemed-transactions').html(function() {
          var str = '';

          var transactionData = data.pointsObj;
          for (var i = 0; i < transactionData.length; i++) {
            if(transactionData[i].pointsTxType=="usePoints"){
            redeemPoint = redeemPoint+ parseInt(transactionData[i].points);  
            str = str + '<p>timeStamp: ' + transactionData[i].txTimestamp + '<br />partner: ' + transactionData[i].partnerid + '<br />member: ' + transactionData[i].accountNumber + '<br />points: ' + transactionData[i].points + '<br />transactionID: ' + transactionData[i].txID + '</p><br>';
            }
          }
          return str;
        });

        pointBalance = earnPoint - redeemPoint;

        //update heading
        $('.heading').html(function() {
          var str = '<h2><b>' + data.firstName + ' ' + data.lastName + '</b></h2>';
          str = str + '<h2><b>' + data.accountNumber + '</b></h2>';
          str = str + '<h2><b><span class="TotalPointBalance">' + pointBalance + '</span></b></h2>';

          return str;
        });
      }

    },
    error: function(jqXHR, textStatus, errorThrown) {
      //reload on error
      alert("Error: Try again")
      console.log(errorThrown);
      console.log(textStatus);
      console.log(jqXHR);
    },
    complete: function() {

    }
  });


  // ajax call for partners data   
  $.ajax({
    type: 'POST',
    url: apiUrl + 'allPartnerData',
    data: inputData,
    dataType: 'json',
    contentType: 'application/json',
    beforeSend: function() {
      //display loading
      document.getElementById('loader').style.display = "block";
    },
    success: function(data) {
      
      //check data for error
      if (data.error) {
        alert(data.error);
        return;
      } else {

        //update partners dropdown for earn points transaction
        $('.earn-partner select').html(function() {
          var str = '<option value="" disabled="" selected="">select</option>';
          var partnersData = data;
          for (var i = 0; i < partnersData.length; i++) {
            str = str + '<option partner-id=' + partnersData[i].partnerid + '> ' + partnersData[i].firstName + '</option>';
          }
          return str;
        });

       

        //update partners dropdown for use points transaction
        $('.use-partner select').html(function() {
          var str = '<option value="" disabled="" selected="">select</option>';
          var partnersData = data;
          for (var i = 0; i < partnersData.length; i++) {
            str = str + '<option partner-id=' + partnersData[i].partnerid + '> ' + partnersData[i].firstName + '</option>';
          }
          return str;
          });       
        }
        
        //remove loader
        document.getElementById('loader').style.display = "none";
        
        //remove login section and display member page
        document.getElementById('loginSection').style.display = "none";
        document.getElementById('transactionSection').style.display = "block";

    },
    error: function(jqXHR, textStatus, errorThrown) {
      //reload on error
      alert("Error: Try again")
      console.log(errorThrown);
      console.log(textStatus);
      console.log(jqXHR);
    },
    complete: function() {
        
    }
  });
}


$('.earn-points-30').click(function() {
  earnPoints(30);
});

$('.earn-points-80').click(function() {
  earnPoints(80);
});

$('.earn-points-200').click(function() {
  earnPoints(200);
});


//check user input and call server
$('.earn-points-transaction').click(function() {

  var formPoints = $('.earnPoints input').val();
  earnPoints(formPoints);
});


function earnPoints(formPoints) {

  //get user input data
  var formAccountNum = $('.account-number input').val();
  var formCardId = $('.card-id input').val();
  var formPartnerId = $('.earn-partner select').find(":selected").attr('partner-id');

  if(formPartnerId==undefined){
	alert("Please select partner")
	return;
  }

  //create json data
  var inputData = '{' + '"accountnumber" : "' + formAccountNum + '", ' + '"cardid" : "' + formCardId + '", ' + '"points" : "' + formPoints + '", ' + '"partnerid" : "' + formPartnerId + '"}';
  console.log(inputData)

  //make ajax call
  $.ajax({
    type: 'POST',
    url: apiUrl + 'earnPoints',
    data: inputData,
    dataType: 'json',
    contentType: 'application/json',
    beforeSend: function() {
      //display loading
      document.getElementById('loader').style.display = "block";
      document.getElementById('infoSection').style.display = "none";
    },
    success: function(data) {

      document.getElementById('loader').style.display = "none";
      document.getElementById('infoSection').style.display = "block";

      //check data for error
      if (data.error) {
        //alert(data.error);
	alert("failed try again.");
        return;
      } else {
        //update member page and notify successful transaction
        updateMember();
        alert('Transaction successful '+data.txid);
      }


    },
    error: function(jqXHR, textStatus, errorThrown) {
      alert("Error: Try again")
      console.log(errorThrown);
      console.log(textStatus);
      console.log(jqXHR);
    }
  });

}

$('.use-points-50').click(function() {
  usePoints(50);
});

$('.use-points-150').click(function() {
  usePoints(100);
});

$('.use-points-200').click(function() {
  usePoints(150);
});


//check user input and call server
$('.use-points-transaction').click(function() {
  var formPoints = $('.usePoints input').val();
  usePoints(formPoints);
});


function usePoints(formPoints) {

  //get user input data
  var formAccountNum = $('.account-number input').val();
  var formCardId = $('.card-id input').val();
  var formPartnerId = $('.use-partner select').find(":selected").attr('partner-id');
  var pointBalance = parseInt($('span.TotalPointBalance').html());
  if(formPartnerId==undefined){
        alert("Please select partner")
        return;
  }

 
  if(pointBalance<parseInt(formPoints)){
	alert("insufficient points")
	return;
  }
	
  //create json data
  var inputData = '{' + '"accountnumber" : "' + formAccountNum + '", ' + '"cardid" : "' + formCardId + '", ' + '"points" : "' + formPoints + '", ' + '"partnerid" : "' + formPartnerId + '"}';
  console.log(inputData)

  //make ajax call
  $.ajax({
    type: 'POST',
    url: apiUrl + 'usePoints',
    data: inputData,
    dataType: 'json',
    contentType: 'application/json',
    beforeSend: function() {
      //display loading
      document.getElementById('loader').style.display = "block";
      document.getElementById('infoSection').style.display = "none";
    },
    success: function(data) {

      document.getElementById('loader').style.display = "none";
      document.getElementById('infoSection').style.display = "block";

      //check data for error
      if (data.error) {
       // alert(data.error);
	alert("Failed please try again");
        return;
      } else {
        //update member page and notify successful transaction
        updateMember();
        alert('Transaction successful '+ data.txid );
      }

    },
    error: function(jqXHR, textStatus, errorThrown) {
      alert("Error: Try again")
      console.log(errorThrown);
      console.log(textStatus);
      console.log(jqXHR);
    },
    complete: function() {}
  });

}

